import * as crypto from 'crypto';
import * as vscode from 'vscode';
import type { GitRepositoryService } from '../git-repository-service';
import { parseNameStatus, statusLabel } from '../../engine/log/commit-files';
import { applyClientFilters, toClientFilter, type LogFilter } from '../../engine/log/log-filter';
import { DEFAULT_LANE_PALETTE } from '../../engine/log/graph-color';
import { computeGraphLayout, maxLanes } from '../../engine/log/graph-layout';
import { parseLogLines } from '../../engine/log/log-line';
import { buildLogArgs, type LogScope } from '../../engine/log/log-query';
import type { GitHubCiService } from '../ci/github-ci-service';
import type {
	CiMetaVM,
	CiStatusVM,
	GraphRowVM,
	LogCommitFileItem,
	LogGraphState,
	LogHostToWebviewMessage,
	LogWebviewToHostMessage,
	RefChip,
} from '../../shared/protocol';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 单页拉取的 commit 数（滚动触底增量加载下一页）。 */
const PAGE = 1000;

/** per-commit 操作 → 既有命令 id（webview 右键菜单 → host 重调用，handler 仅需 hash）。 */
const COMMIT_MENU: ReadonlyArray<{ readonly label: string; readonly command: string }> = [
	{ label: '复制 Hash', command: 'hyperGit.copyCommitHash' },
	{ label: 'Cherry-Pick 此提交', command: 'hyperGit.cherryPick' },
	{ label: 'Revert 此提交', command: 'hyperGit.revertCommit' },
	{ label: 'Drop 此提交（删除最新提交）', command: 'hyperGit.dropCommit' },
	{ label: 'Fixup 此提交', command: 'hyperGit.fixupCommit' },
	{ label: '从此提交新建分支…', command: 'hyperGit.createBranchFromCommit' },
	{ label: '从此提交新建标签…', command: 'hyperGit.createTagFromCommit' },
	{ label: '查看包含此提交的分支', command: 'hyperGit.showContainingBranches' },
	{ label: 'Reset 当前分支到此提交…', command: 'hyperGit.resetToHere' },
];

/** 引用标签查询的 for-each-ref 格式（full objectname 供精确匹配；与 parseChips 字段顺序对应）。 */
const CHIP_REF_FORMAT = '%(objectname)%00%(refname)%00%(refname:short)%00%(HEAD)';

// ─── 命令参数类型（webview 迁移后，命令仍以 LogNode 为参数类型）──────────────────

export interface LogCommitNode {
	readonly kind: 'commit';
	readonly commit: { readonly hash: string; readonly message: string; readonly parents: readonly string[] };
}
export interface LogFileNode {
	readonly kind: 'file';
	readonly hash: string;
}
export type LogNode = LogCommitNode | LogFileNode;

/**
 * Log 视图控制契约：4 个命令注册器按此接口（而非具体 Provider 类）引用，
 * 使 TreeView→Webview 迁移对注册器零行为改动，并便于未来替换实现。
 */
export interface LogFilterControl extends vscode.Disposable {
	setFilter(filter: LogFilter): void;
	clearFilter(): void;
	getFilter(): LogFilter;
	refresh(): void;
}

/** 一页图数据。 */
interface GraphPage {
	readonly rows: readonly GraphRowVM[];
	readonly maxLanes: number;
	readonly hasMore: boolean;
}

/**
 * Log 视图（WebviewView）：可视化提交图（DAG）。
 *
 * 自计算 lane 布局（engine/log/graph-layout）→ 渲染彩色泳道；host 侧单次 `git log --topo-order`
 * 取数 + `for-each-ref` 取引用标签；webview 端虚拟化 SVG 行 + 文本列。保留全部既有交互：
 * 7 个过滤命令（经 {@link LogFilterControl}）、9 个 per-commit 操作（右键 → host 重调用）、
 * 选中提交查看变更文件、All/Current 范围切换、滚动增量加载、实时刷新。
 */
export class LogWebviewProvider implements vscode.WebviewViewProvider, LogFilterControl {
	public static readonly viewType = 'hyperGit.log';

	private view?: vscode.WebviewView;
	private filter: LogFilter = {};
	private scope: LogScope = 'all';
	private refreshTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly service: GitRepositoryService, private readonly ciService: GitHubCiService) {
		// 兜底实时刷新：git 状态变化（commit/checkout 等）防抖重拉首页。
		let t: ReturnType<typeof setTimeout> | undefined;
		this.disposables.push(
			this.service.onDidChange(() => {
				clearTimeout(t);
				t = setTimeout(() => this.refresh(), 400);
			}),
		);
	}

	setFilter(filter: LogFilter): void {
		this.filter = filter;
		this.refresh();
	}

	clearFilter(): void {
		this.filter = {};
		this.refresh();
	}

	getFilter(): LogFilter {
		return this.filter;
	}

	refresh(): void {
		clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => {
			void this.pushState();
		}, 300);
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = { enableScripts: true, localResourceRoots: [] };
		view.webview.html = this.renderHtml();
		const msgSub = view.webview.onDidReceiveMessage((msg) => this.onMessage(msg as LogWebviewToHostMessage));
		view.onDidDispose(() => {
			msgSub.dispose();
			this.view = undefined;
		});
	}

	dispose(): void {
		clearTimeout(this.refreshTimer);
		this.disposables.forEach((d) => d.dispose());
	}

	// ─── Host ↔ Webview 消息 ────────────────────────────────────────────────────

	private onMessage(msg: LogWebviewToHostMessage): void {
		switch (msg.type) {
			case 'log/requestState':
				void this.pushState();
				break;
			case 'log/loadMore':
				void this.loadMore(msg.payload.cursor);
				break;
			case 'log/selectCommit':
				void this.sendCommitFiles(msg.payload.hash);
				break;
			case 'log/openFile':
				void vscode.commands.executeCommand(
					'hyperGit.openCommitFileDiff',
					msg.payload.hash,
					msg.payload.path,
					msg.payload.hasParent,
				);
				break;
			case 'log/setScope':
				this.scope = msg.payload.scope;
				void this.pushState();
				break;
			case 'log/commitAction':
				if (msg.payload.op === 'menu') {
					void this.handleCommitMenu(msg.payload.hash);
				}
				break;
			case 'log/requestCi':
				void this.handleRequestCi(msg.payload.hashes);
				break;
			case 'log/openExternal':
				void this.ciService.openExternal(msg.payload.url);
				break;
			case 'log/ciSignIn':
				void this.handleCiSignIn();
				break;
		}
	}

	private post(message: LogHostToWebviewMessage): void {
		this.view?.webview.postMessage(message);
	}

	// ─── 数据拉取 ───────────────────────────────────────────────────────────────

	private async pushState(): Promise<void> {
		if (!this.view) {
			return;
		}
		this.post({ type: 'log/busy', payload: { busy: true } });
		const page = await this.fetchPage(0);
		if (!page) {
			this.post({ type: 'log/busy', payload: { busy: false } });
			return;
		}
		const state: LogGraphState = {
			rows: page.rows,
			maxLanes: page.maxLanes,
			hasMore: page.hasMore,
			scope: this.scope,
			repoRoot: this.service.repoRoot ?? '',
		};
		this.post({ type: 'log/graphData', payload: state });
		// CI 元信息异步随附（不阻塞建图）：远程为 GitHub 才启用，未授权则提示登录。
		void this.pushCiMeta();
	}

	/** 推送 CI 能力/授权态（status() 廉价：复用缓存会话）。失败静默回退为不可用。 */
	private async pushCiMeta(): Promise<void> {
		if (!this.view) {
			return;
		}
		let meta: CiMetaVM;
		try {
			const s = await this.ciService.status();
			meta = { available: s.available, needsSignIn: s.needsAuth, error: s.error };
		} catch {
			meta = { available: false, needsSignIn: false };
		}
		if (this.view) {
			this.post({ type: 'log/ciMeta', payload: meta });
		}
	}

	/** 懒加载可见行 CI（webview 滚动按需请求），取数后守卫 view 仍存在再回填。 */
	private async handleRequestCi(hashes: readonly string[]): Promise<void> {
		if (hashes.length === 0) {
			return;
		}
		const map = await this.ciService.getStatuses(hashes);
		if (!this.view || map.size === 0) {
			return;
		}
		const rec: Record<string, CiStatusVM> = {};
		for (const [hash, vm] of map) {
			rec[hash] = vm;
		}
		this.post({ type: 'log/ciData', payload: { map: rec } });
	}

	/** 用户点击「登录 GitHub 查看 CI」：走原生授权，完成后刷新 CI 元信息。 */
	private async handleCiSignIn(): Promise<void> {
		await this.ciService.signIn();
		await this.pushCiMeta();
	}

	private async loadMore(cursor: number): Promise<void> {
		const page = await this.fetchPage(cursor);
		if (!page || page.rows.length === 0) {
			this.post({ type: 'log/busy', payload: { busy: false } });
			return;
		}
		this.post({
			type: 'log/appendData',
			payload: { rows: page.rows, maxLanes: page.maxLanes, hasMore: page.hasMore },
		});
	}

	private async fetchPage(skip: number): Promise<GraphPage | undefined> {
		const repo = this.service.repo;
		if (!repo) {
			return undefined;
		}
		try {
			const out = await this.service.execGit(['log', ...buildLogArgs(this.filter, this.scope, { maxCount: PAGE, skip })]);
			const raws = parseLogLines(out);
			if (raws.length === 0) {
				return { rows: [], maxLanes: 0, hasMore: false };
			}
			// 客户端过滤（mergeMode / date / regex / checkpoint），message 近似取 subject。
			// keepCheckpoint 由 scope 驱动：仅 Checkpointer 视图保留 checkpoint 自动提交，All/Current 剔除。
			const filterable = raws.map((r) => ({
				message: r.subject,
				authorDate: r.authorDate ? new Date(r.authorDate) : undefined,
				parents: r.parents,
				hash: r.hash,
				raw: r,
			}));
			const survived = applyClientFilters(filterable, { ...toClientFilter(this.filter), keepCheckpoint: this.scope === 'checkpointer' });
			const layout = computeGraphLayout(survived.map((s) => ({ hash: s.hash, parents: s.parents })));
			const hashSet = new Set(survived.map((s) => s.hash));
			const chips = await this.fetchChips(hashSet);
			const rows: GraphRowVM[] = survived.map((s, i) => ({
				hash: s.raw.hash,
				shortHash: s.raw.hash.slice(0, 7),
				parents: s.raw.parents,
				isMerge: s.raw.parents.length > 1,
				subject: s.raw.subject,
				authorName: s.raw.authorName,
				authorDate: s.raw.authorDate,
				chips: chips.get(s.raw.hash) ?? [],
				layout: layout[i],
			}));
			return { rows, maxLanes: maxLanes(layout), hasMore: raws.length === PAGE };
		} catch (e) {
			void vscode.window.showErrorMessage(`获取提交图失败：${errMsg(e)}`);
			return undefined;
		}
	}

	/** 取引用标签：for-each-ref（full hash 精确匹配）+ repo.state.HEAD 标注当前分支 / detached HEAD。 */
	private async fetchChips(hashes: Set<string>): Promise<Map<string, RefChip[]>> {
		const map = new Map<string, RefChip[]>();
		const headCommit = this.service.repo?.state.HEAD?.commit;
		const detached = headCommit && !this.service.repo?.state.HEAD?.name;
		try {
			const out = await this.service.execGit(['for-each-ref', `--format=${CHIP_REF_FORMAT}`, 'refs/heads', 'refs/remotes', 'refs/tags']);
			for (const line of out.split('\n')) {
				if (line.length === 0) {
					continue;
				}
				const [hash, refname, shortName, headMark] = line.split('\x00');
				if (!hash || !refname || !hashes.has(hash)) {
					continue;
				}
				const kind: RefChip['kind'] = refname.startsWith('refs/tags/')
					? 'tag'
					: refname.startsWith('refs/remotes/')
						? 'remoteBranch'
						: 'localBranch';
				const isHeadTarget = headMark === '*' || hash === headCommit;
				this.pushChip(map, hash, { name: shortName, kind, isHeadTarget });
			}
		} catch {
			// 引用标签为增强信息，失败不影响图主体。
		}
		if (detached && headCommit && hashes.has(headCommit)) {
			this.pushChip(map, headCommit, { name: 'HEAD', kind: 'head' });
		}
		// 排序：head → local → remote → tag（稳定）。
		const order: Record<RefChip['kind'], number> = { head: 0, localBranch: 1, remoteBranch: 2, tag: 3 };
		for (const list of map.values()) {
			list.sort((a, b) => order[a.kind] - order[b.kind]);
		}
		return map;
	}

	private pushChip(map: Map<string, RefChip[]>, hash: string, chip: RefChip): void {
		const list = map.get(hash);
		if (list) {
			list.push(chip);
		} else {
			map.set(hash, [chip]);
		}
	}

	private async sendCommitFiles(hash: string): Promise<void> {
		const repo = this.service.repo;
		if (!repo) {
			return;
		}
		try {
			// 复用 Log 既有逻辑：diff-tree 取变更文件。
			const out = await this.service.execGit(['diff-tree', '--no-commit-id', '--name-status', '-r', '--root', hash]);
			const changes = parseNameStatus(out);
			const files: LogCommitFileItem[] = changes.map((c) => ({
				status: c.status,
				statusLabel: statusLabel(c.status),
				path: c.oldPath ? `${c.oldPath} → ${c.path}` : c.path,
				oldPath: c.oldPath,
				themeColor: fileIconColor(c.status),
			}));
			this.post({ type: 'log/commitFiles', payload: { hash, files } });
		} catch {
			this.post({ type: 'log/commitFiles', payload: { hash, files: [] } });
		}
	}

	private async handleCommitMenu(hash: string): Promise<void> {
		const nodeLike: LogCommitNode = { kind: 'commit', commit: { hash, message: '', parents: [] } };
		const items = COMMIT_MENU.map((m) => ({ label: m.label, command: m.command }));
		const pick = await vscode.window.showQuickPick(items, { placeHolder: `提交 ${hash.slice(0, 7)}` });
		if (!pick) {
			return;
		}
		await vscode.commands.executeCommand(pick.command, nodeLike);
	}

	// ─── HTML 渲染 ──────────────────────────────────────────────────────────────

	private renderHtml(): string {
		const nonce = crypto.randomBytes(16).toString('base64');
		const palette = JSON.stringify(DEFAULT_LANE_PALETTE);
		const csp = ['default-src \'none\'', 'style-src \'unsafe-inline\'', `script-src 'nonce-${nonce}'`].join('; ');
		return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
:root { --hg-row: 24px; --hg-lane: 14px; }
* { box-sizing: border-box; }
body { margin: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-sideBar-background); display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
.toolbar { display: flex; align-items: center; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.25)); }
.seg { display: inline-flex; border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; overflow: hidden; }
.seg button { background: transparent; color: var(--vscode-foreground); border: none; padding: 2px 8px; font-size: 11px; cursor: pointer; opacity: 0.7; }
.seg button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); opacity: 1; }
.repo { margin-left: auto; font-size: 10px; opacity: 0.55; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#viewport { flex: 1; overflow-y: auto; overflow-x: hidden; position: relative; outline: none; }
#spacer { position: relative; }
#rows { position: absolute; left: 0; right: 0; }
.row { display: flex; align-items: center; height: var(--hg-row); padding-right: 8px; cursor: pointer; white-space: nowrap; }
.row:hover { background: var(--vscode-list-hoverBackground); }
.row.selected { background: var(--vscode-list-activeSelectionBackground, var(--vscode-list-inactiveSelectionBackground)); }
.row svg.graph { flex: 0 0 auto; display: block; }
.row svg.graph .node { stroke: var(--vscode-sideBar-background); stroke-width: 1.5; }
.row.selected svg.graph .node { stroke: var(--vscode-focusBorder); stroke-width: 2.2; }
.subject { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 4px; }
.msg { overflow: hidden; text-overflow: ellipsis; }
.merge { opacity: 0.6; font-size: 10px; padding: 0 2px; }
.chips { display: inline-flex; gap: 3px; flex: 0 1 auto; min-width: 0; overflow: hidden; }
.chip { font-size: 10px; padding: 0 5px; border-radius: 8px; border: 1px solid transparent; white-space: nowrap; max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
.chip.head { background: var(--vscode-statusBarItem-prominentBackground, var(--vscode-button-background)); color: var(--vscode-statusBarItem-prominentForeground, var(--vscode-button-foreground)); font-weight: 600; }
.chip.localBranch { color: var(--vscode-gitDecoration-stageModifiedResourceForeground, #58a6ff); border-color: var(--vscode-gitDecoration-stageModifiedResourceForeground, #58a6ff); }
.chip.head-target { font-weight: 700; }
.chip.remoteBranch { color: var(--vscode-gitDecoration-modifiedResourceForeground, #d29922); border-color: var(--vscode-gitDecoration-modifiedResourceForeground, #d29922); }
.chip.tag { color: var(--vscode-gitDecoration-conflictingResourceForeground, #3fb950); border-color: var(--vscode-gitDecoration-conflictingResourceForeground, #3fb950); }
.author { flex: 0 0 auto; font-size: 11px; opacity: 0.7; max-width: 110px; overflow: hidden; text-overflow: ellipsis; padding-left: 8px; }
.date { flex: 0 0 auto; font-size: 11px; opacity: 0.55; padding-left: 8px; }
#viewport.narrow .author, #viewport.narrow .date { display: none; }
#details { flex: 0 0 auto; max-height: 38%; overflow-y: auto; border-top: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.25)); display: none; }
#details.show { display: block; }
#details .dh { position: sticky; top: 0; background: var(--vscode-sideBar-background); padding: 4px 8px; font-size: 11px; opacity: 0.8; border-bottom: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.15)); }
#details .file { display: flex; align-items: center; gap: 6px; padding: 2px 10px; font-size: 12px; cursor: pointer; }
#details .file:hover { background: var(--vscode-list-hoverBackground); }
#details .file .dot { font-size: 13px; line-height: 1; }
#details .file .nm { overflow: hidden; text-overflow: ellipsis; }
#empty { padding: 16px; text-align: center; opacity: 0.6; font-size: 12px; }
#spinner { position: absolute; bottom: 6px; right: 8px; font-size: 11px; opacity: 0.6; display: none; }
/* ── CI 状态图标（提交行最右侧，固定 16px 槽位，保证 author/date 列对齐）── */
.ci { flex: 0 0 16px; width: 16px; display: inline-flex; align-items: center; justify-content: center; }
.ci svg { display: block; shape-rendering: geometricPrecision; pointer-events: none; }
.ci-success { color: var(--vscode-testing-iconPassed, #3fb950); }
.ci-failure { color: var(--vscode-testing-iconFailed, var(--vscode-errorForeground, #f85149)); }
.ci-pending { color: var(--vscode-testing-iconQueued, var(--vscode-editorWarning-foreground, #d29922)); }
.ci:not(.ci-empty):hover { filter: brightness(1.15); }
.ci:not(.ci-empty):focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; border-radius: 3px; }
/* narrow 模式隐藏 author/date，但 CI 图标例外保留（核心信号）。 */
#viewport.narrow .ci { display: inline-flex; }
@keyframes ci-rot { to { transform: rotate(360deg); } }
.ci-spin { transform-origin: 50% 50%; animation: ci-rot 1s linear infinite; }
@media (prefers-reduced-motion: reduce) { .ci-spin { animation: none; } }
.ci-signin { display: none; background: transparent; border: 1px solid var(--vscode-button-border, var(--vscode-input-border, transparent)); color: var(--vscode-textLink-foreground); font-size: 10px; padding: 1px 6px; border-radius: 3px; cursor: pointer; opacity: 0.85; }
.ci-signin:hover { opacity: 1; background: var(--vscode-list-hoverBackground); }
/* ── CI Tooltip（自定义浮层，置于 #rows 之外，虚拟滚动重写不销毁）── */
#ci-tip { position: fixed; z-index: 50; display: none; max-width: 360px; min-width: 220px; max-height: 320px; overflow: hidden; background: var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background)); color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground)); border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-editorWidget-border, rgba(128,128,128,.3))); border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,.35); font-size: 12px; }
#ci-tip.show { display: flex; flex-direction: column; }
#ci-tip .tip-h { padding: 7px 10px; font-weight: 600; border-bottom: 1px solid var(--vscode-editorHoverWidget-border, rgba(128,128,128,.2)); display: flex; align-items: center; gap: 6px; }
#ci-tip .tip-h .g { flex: 0 0 14px; display: inline-flex; }
#ci-tip .tip-list { overflow-y: auto; max-height: 240px; padding: 2px 0; }
#ci-tip .tip-row { display: flex; align-items: flex-start; gap: 7px; padding: 4px 10px; cursor: pointer; }
#ci-tip .tip-row:hover { background: var(--vscode-list-hoverBackground); }
#ci-tip .tip-row .g { flex: 0 0 14px; display: inline-flex; margin-top: 1px; }
#ci-tip .tip-row .nm { flex: 1 1 auto; min-width: 0; overflow: hidden; }
#ci-tip .tip-row .nm .desc { display: block; font-size: 11px; opacity: 0.7; white-space: normal; word-break: break-word; margin-top: 1px; }
#ci-tip .tip-foot { padding: 6px 10px; border-top: 1px solid var(--vscode-editorHoverWidget-border, rgba(128,128,128,.2)); }
#ci-tip .tip-foot a { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: none; }
#ci-tip .tip-foot a:hover { text-decoration: underline; }
#ci-tip .g-success { color: var(--vscode-testing-iconPassed, #3fb950); }
#ci-tip .g-failure { color: var(--vscode-testing-iconFailed, var(--vscode-errorForeground, #f85149)); }
#ci-tip .g-pending { color: var(--vscode-testing-iconQueued, var(--vscode-editorWarning-foreground, #d29922)); }
#ci-tip .g-skipped { color: var(--vscode-descriptionForeground, #8b949e); }
</style>
</head>
<body>
<div class="toolbar">
  <span class="seg">
    <button id="scope-all" class="active">All</button>
    <button id="scope-current">Current</button>
    <button id="scope-checkpointer">Checkpointer</button>
  </span>
  <span class="repo" id="repo"></span>
  <button id="ci-signin" class="ci-signin" title="登录 GitHub 查看 CI 状态">登录 GitHub</button>
</div>
<div id="viewport" tabindex="0">
  <div id="spacer"><div id="rows"></div></div>
  <div id="empty">暂无提交</div>
  <div id="spinner">加载中…</div>
</div>
<div id="details"><div class="dh" id="details-head"></div><div id="details-list"></div></div>
<div id="ci-tip" role="dialog" aria-label="CI 检查详情"></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const PALETTE = ${palette};
const ROW_H = 24, LANE_W = 14, NODE_R = 4, GUTTER = 10, OVERSCAN = 8, LOAD_THRESHOLD = 40;
/** scope 白名单兜底：仅接受三态，否则回退默认 'all'（兼容未来废弃的持久化值）。 */
function normalizeScope(v) { return v === 'all' || v === 'current' || v === 'checkpointer' ? v : 'all'; }
const persisted = vscode.getState() || {};
let selectedHash = persisted.selectedHash || null;
let scope = normalizeScope(persisted.scope);
let model = { rows: [], maxLanes: 0, hasMore: false, repoRoot: '' };
let renderedFirst = -1, renderedLast = -1, fetching = false;
// ── CI 状态（懒加载、仅取可见行；ciByHash 缓存、ciRequested 去重、ciPending 防抖批量）──
const ciByHash = Object.create(null);
const ciRequested = new Set();
const ciPending = new Set();
let ciMeta = { available: false, needsSignIn: false, error: '' };
let ciReqTimer = null;
const ciTipEl = document.getElementById('ci-tip');
const ciSignInEl = document.getElementById('ci-signin');
let tipHash = null, tipShowT = null, tipHideT = null, overIcon = false, overTip = false;
const viewport = document.getElementById('viewport');
const spacer = document.getElementById('spacer');
const rowsEl = document.getElementById('rows');
const repoEl = document.getElementById('repo');
const emptyEl = document.getElementById('empty');
const spinnerEl = document.getElementById('spinner');
const detailsEl = document.getElementById('details');
const detailsHead = document.getElementById('details-head');
const detailsList = document.getElementById('details-list');

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function laneColor(i) { return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length]; }
function colX(c) { return c * LANE_W + LANE_W / 2; }
/** 本行实际绘制的最右列号（node + 各边 from/to 的最大值）——行宽据此自适应，消除「全局 maxLanes 撑宽」的留白。 */
function rowMaxCol(row) { const L = row.layout; let m = L.node.col; for (const e of L.incoming) { if (e.fromCol > m) m = e.fromCol; if (e.toCol > m) m = e.toCol; } for (const e of L.outgoing) { if (e.fromCol > m) m = e.fromCol; if (e.toCol > m) m = e.toCol; } for (const e of L.passThrough) { if (e.fromCol > m) m = e.fromCol; if (e.toCol > m) m = e.toCol; } return m; }
function fmtDate(iso) { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; const m = String(d.getMonth() + 1).padStart(2, '0'); const da = String(d.getDate()).padStart(2, '0'); return d.getFullYear() + '-' + m + '-' + da; }

function rowSvg(row) {
  const L = row.layout;
  const cy = ROW_H / 2;
  const W = (rowMaxCol(row) + 1) * LANE_W + GUTTER;
  const p = ['<svg class="graph" width="', W, '" height="', ROW_H, '" viewBox="0 0 ', W, ' ', ROW_H, '" xmlns="http://www.w3.org/2000/svg">'];
  const seg = (e) => 'stroke="' + laneColor(e.colorIdx) + '" stroke-width="1.6" stroke-linecap="round"';
  for (const e of L.passThrough) p.push('<line x1="', colX(e.fromCol), '" y1="0" x2="', colX(e.toCol), '" y2="', ROW_H, '" ', seg(e), '/>');
  for (const e of L.incoming) p.push('<line x1="', colX(e.fromCol), '" y1="0" x2="', colX(e.toCol), '" y2="', cy, '" ', seg(e), '/>');
  for (const e of L.outgoing) {
    const y2 = e.kind === 'dangling' ? ROW_H * 0.78 : ROW_H;
    const op = e.kind === 'dangling' ? ' opacity="0.45"' : '';
    p.push('<line x1="', colX(e.fromCol), '" y1="', cy, '" x2="', colX(e.toCol), '" y2="', y2, '"', op, ' ', seg(e), '/>');
  }
  p.push('<circle class="node" cx="', colX(L.node.col), '" cy="', cy, '" r="', NODE_R, '" fill="', laneColor(L.node.colorIdx), '"/>');
  p.push('</svg>');
  return p.join('');
}

function chipsHtml(row) {
  if (!row.chips || row.chips.length === 0) return '';
  const parts = ['<span class="chips">'];
  for (const c of row.chips) {
    const cls = 'chip ' + c.kind + (c.isHeadTarget ? ' head-target' : '');
    parts.push('<span class="', cls, '" title="', esc(c.name), '">', esc(c.name), '</span>');
  }
  parts.push('</span>');
  return parts.join('');
}

function ciGlyph(state) {
  if (state === 'success') return '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4.8 8.2l2.1 2.1 4.3-4.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  if (state === 'failure') return '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  if (state === 'pending') return '<svg class="ci-spin" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="10 30"/></svg>';
  return '';
}

/** 提交行最右侧的 CI 槽位（固定 16px 保列对齐；available=false 零宽；无数据=空槽不交互）。 */
function ciSlotHtml(row) {
  if (!ciMeta.available) return '';
  const ci = ciByHash[row.hash];
  if (!ci || ci.state === 'unknown') {
    return '<span class="ci ci-empty" aria-hidden="true"></span>';
  }
  const failed = ci.total - ci.passed;
  const a11y = ci.state === 'success' ? 'CI 通过 ' + ci.passed + '/' + ci.total
    : ci.state === 'failure' ? 'CI 失败 ' + failed + '/' + ci.total + ' 项未通过'
    : 'CI 运行中 ' + ci.passed + '/' + ci.total;
  return '<span class="ci ci-' + ci.state + '" data-ci="' + esc(row.hash) + '" tabindex="0" role="button" aria-label="' + esc(a11y) + '">' + ciGlyph(ci.state) + '</span>';
}

function rowHtml(row, idx) {
  const sel = row.hash === selectedHash ? ' selected' : '';
  const merge = row.isMerge ? '<span class="merge" title="合并提交">⇠</span>' : '';
  return '<div class="row' + sel + '" data-i="' + idx + '" data-hash="' + esc(row.hash) + '" role="treeitem" aria-selected="' + (sel !== '') + '">'
    + rowSvg(row)
    + '<span class="subject">' + chipsHtml(row) + '<span class="msg">' + esc(row.subject) + '</span>' + merge + '</span>'
    + '<span class="author">' + esc(row.authorName) + '</span>'
    + '<span class="date">' + fmtDate(row.authorDate) + '</span>'
    + ciSlotHtml(row)
    + '</div>';
}

function render() {
  const total = model.rows.length;
  const sh = viewport.scrollTop;
  const ch = viewport.clientHeight;
  const f = Math.max(0, Math.floor(sh / ROW_H) - OVERSCAN);
  const n = Math.ceil(ch / ROW_H) + OVERSCAN * 2;
  const l = Math.min(total, f + n);
  if (f !== renderedFirst || l !== renderedLast) {
    renderedFirst = f; renderedLast = l;
    const html = [];
    for (let i = f; i < l; i++) html.push(rowHtml(model.rows[i], i));
    rowsEl.innerHTML = html.join('');
    rowsEl.style.transform = 'translateY(' + (f * ROW_H) + 'px)';
  }
  collectCiRequests(f, l);
  spacer.style.height = (total * ROW_H) + 'px';
  emptyEl.style.display = total === 0 ? 'block' : 'none';
  document.getElementById('scope-all').classList.toggle('active', scope === 'all');
  document.getElementById('scope-current').classList.toggle('active', scope === 'current');
  document.getElementById('scope-checkpointer').classList.toggle('active', scope === 'checkpointer');
  if (model.hasMore && !fetching && l >= total - LOAD_THRESHOLD) {
    fetching = true; spinnerEl.style.display = 'block';
    vscode.postMessage({ type: 'log/loadMore', payload: { cursor: total } });
  }
}

function scheduleRender() { requestAnimationFrame(render); }

/** 收集可见行中尚未取数的 hash（O(可见行)，幂等），防抖后批量请求，绝不重复请求已知项。 */
function collectCiRequests(f, l) {
  if (!ciMeta.available) return;
  for (let i = f; i < l; i++) {
    const h = model.rows[i] && model.rows[i].hash;
    if (!h || (h in ciByHash) || ciRequested.has(h)) continue;
    ciRequested.add(h);
    ciPending.add(h);
  }
  if (ciPending.size === 0 || ciReqTimer) return;
  ciReqTimer = setTimeout(flushCiRequests, 200);
}
function flushCiRequests() {
  ciReqTimer = null;
  if (ciPending.size === 0) return;
  const hashes = Array.from(ciPending);
  ciPending.clear();
  vscode.postMessage({ type: 'log/requestCi', payload: { hashes: hashes } });
}

// ── CI Tooltip（自定义浮层：列明细 + 失败原因 + 跳转链接）──
function tipGlyph(state) {
  if (state === 'skipped' || state === 'unknown') {
    return '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M4 8h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  }
  return ciGlyph(state);
}
function buildTip(ci) {
  const headState = ci.state === 'success' ? 'success' : ci.state === 'failure' ? 'failure' : 'pending';
  const headTxt = ci.state === 'success' ? ('全部 ' + ci.total + ' 项检查通过')
    : ci.state === 'failure' ? ((ci.total - ci.passed) + ' / ' + ci.total + ' 项检查未通过')
    : ci.state === 'pending' ? ('检查运行中 ' + ci.passed + ' / ' + ci.total) : 'CI 状态未知';
  // 失败项前置，悬停即可见未通过原因。
  const ordered = ci.checks.slice().sort(function (a, b) {
    return (a.state === 'failure' ? 0 : 1) - (b.state === 'failure' ? 0 : 1);
  });
  const parts = ['<div class="tip-h"><span class="g g-', headState, '">', ciGlyph(headState), '</span>', esc(headTxt), '</div><div class="tip-list">'];
  if (ordered.length === 0) parts.push('<div class="tip-row" style="opacity:.6;cursor:default">暂无检查明细</div>');
  for (const c of ordered) {
    const desc = (c.state === 'failure' && c.description) ? '<span class="desc">' + esc(c.description) + '</span>' : '';
    parts.push('<div class="tip-row" data-url="', esc(c.url || ''), '" role="link" tabindex="0">', tipGlyph(c.state), '<span class="nm">', esc(c.name), desc, '</span></div>');
  }
  parts.push('</div>');
  if (ci.url) parts.push('<div class="tip-foot"><a data-url="', esc(ci.url), '" role="link" tabindex="0">在 GitHub 上查看</a></div>');
  ciTipEl.innerHTML = parts.join('');
}
function positionTip(rect) {
  ciTipEl.style.display = 'flex';
  const tw = ciTipEl.offsetWidth, th = ciTipEl.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight, pad = 6;
  let left = rect.left;
  if (left + tw > vw - pad) left = vw - pad - tw;
  if (left < pad) left = pad;
  let top = rect.bottom + 4;
  if (top + th > vh - pad) top = rect.top - th - 4;
  if (top < pad) top = pad;
  ciTipEl.style.left = left + 'px';
  ciTipEl.style.top = top + 'px';
}
function scheduleShow(hash, iconEl) {
  clearTimeout(tipHideT);
  if (tipHash === hash && ciTipEl.classList.contains('show')) return;
  clearTimeout(tipShowT);
  tipShowT = setTimeout(function () {
    const ci = ciByHash[hash];
    if (!ci || ci.state === 'unknown') return;
    tipHash = hash;
    buildTip(ci);
    positionTip(iconEl.getBoundingClientRect());
    ciTipEl.classList.add('show');
  }, 350);
}
function scheduleHide() {
  clearTimeout(tipShowT);
  clearTimeout(tipHideT);
  tipHideT = setTimeout(function () { if (!overIcon && !overTip) hideTip(); }, 220);
}
function hideTip() {
  ciTipEl.classList.remove('show');
  ciTipEl.style.display = 'none';
  tipHash = null;
}
function openCiUrl(url) { if (url) vscode.postMessage({ type: 'log/openExternal', payload: { url: url } }); }
function renderCiMeta() { ciSignInEl.style.display = ciMeta.needsSignIn ? 'inline-block' : 'none'; }

function selectRow(hash) {
  selectedHash = hash;
  vscode.setState({ selectedHash: hash, scope: scope });
  renderedFirst = -1; scheduleRender();
  vscode.postMessage({ type: 'log/selectCommit', payload: { hash: hash } });
}

function indexOfHash(hash) { for (let i = 0; i < model.rows.length; i++) if (model.rows[i].hash === hash) return i; return -1; }

function moveSel(delta) {
  if (model.rows.length === 0) return;
  let i = indexOfHash(selectedHash);
  if (i < 0) i = delta > 0 ? -1 : 0;
  i = Math.max(0, Math.min(model.rows.length - 1, i + delta));
  const h = model.rows[i].hash;
  selectRow(h);
  const top = i * ROW_H;
  if (top < viewport.scrollTop || top + ROW_H > viewport.scrollTop + viewport.clientHeight) {
    viewport.scrollTop = top - ROW_H;
  }
}

rowsEl.addEventListener('click', function (e) {
  if (e.target.closest('.ci')) return; // 点击 CI 图标不选中提交行
  const r = e.target.closest('.row'); if (!r) return;
  selectRow(r.getAttribute('data-hash'));
});
rowsEl.addEventListener('mouseover', function (e) {
  const icon = e.target.closest && e.target.closest('.ci');
  if (!icon || icon.classList.contains('ci-empty')) return;
  overIcon = true;
  scheduleShow(icon.getAttribute('data-ci'), icon);
});
rowsEl.addEventListener('mouseout', function (e) {
  const icon = e.target.closest && e.target.closest('.ci');
  if (!icon) return;
  overIcon = false;
  scheduleHide();
});
rowsEl.addEventListener('keydown', function (e) {
  const icon = e.target.closest && e.target.closest('.ci');
  if (!icon || icon.classList.contains('ci-empty')) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault(); e.stopPropagation(); // 阻止冒泡到 viewport 的 Enter→菜单
    const ci = ciByHash[icon.getAttribute('data-ci')];
    if (!ci || ci.state === 'unknown') return;
    tipHash = icon.getAttribute('data-ci');
    buildTip(ci);
    positionTip(icon.getBoundingClientRect());
    ciTipEl.classList.add('show');
    const first = ciTipEl.querySelector('[data-url]'); if (first) first.focus();
  }
});
ciTipEl.addEventListener('mouseenter', function () { overTip = true; clearTimeout(tipHideT); });
ciTipEl.addEventListener('mouseleave', function () { overTip = false; scheduleHide(); });
ciTipEl.addEventListener('click', function (e) {
  const t = e.target.closest('[data-url]'); if (!t) return;
  openCiUrl(t.getAttribute('data-url'));
});
ciTipEl.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') { hideTip(); }
  else if (e.key === 'Enter') { const t = e.target.closest('[data-url]'); if (t) openCiUrl(t.getAttribute('data-url')); }
});
ciSignInEl.addEventListener('click', function () { vscode.postMessage({ type: 'log/ciSignIn' }); });
rowsEl.addEventListener('dblclick', function (e) {
  const r = e.target.closest('.row'); if (!r) return;
  vscode.postMessage({ type: 'log/commitAction', payload: { op: 'menu', hash: r.getAttribute('data-hash') } });
});
rowsEl.addEventListener('contextmenu', function (e) {
  const r = e.target.closest('.row'); if (!r) return;
  e.preventDefault();
  vscode.postMessage({ type: 'log/commitAction', payload: { op: 'menu', hash: r.getAttribute('data-hash') } });
});
function setScope(next) { if (scope !== next) { scope = next; vscode.setState({ selectedHash: selectedHash, scope: scope }); vscode.postMessage({ type: 'log/setScope', payload: { scope: next } }); } }
document.getElementById('scope-all').addEventListener('click', function () { setScope('all'); });
document.getElementById('scope-current').addEventListener('click', function () { setScope('current'); });
document.getElementById('scope-checkpointer').addEventListener('click', function () { setScope('checkpointer'); });
viewport.addEventListener('scroll', scheduleRender, { passive: true });
viewport.addEventListener('scroll', function () { if (tipHash) hideTip(); }, { passive: true });
viewport.addEventListener('keydown', function (e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
  else if (e.key === 'Home') { e.preventDefault(); if (model.rows.length) selectRow(model.rows[0].hash); }
  else if (e.key === 'End') { e.preventDefault(); if (model.rows.length) selectRow(model.rows[model.rows.length - 1].hash); }
  else if (e.key === 'Enter') { e.preventDefault(); if (selectedHash) vscode.postMessage({ type: 'log/commitAction', payload: { op: 'menu', hash: selectedHash } }); }
});
detailsList.addEventListener('click', function (e) {
  const f = e.target.closest('.file'); if (!f) return;
  vscode.postMessage({ type: 'log/openFile', payload: { hash: f.getAttribute('data-hash'), path: f.getAttribute('data-path'), hasParent: f.getAttribute('data-hasparent') === '1' } });
});

function renderDetails(hash, files) {
  if (!hash) { detailsEl.classList.remove('show'); return; }
  const row = model.rows.find(function (r) { return r.hash === hash; });
  const hasParent = row && row.parents && row.parents.length > 0 ? '1' : '0';
  detailsHead.textContent = '变更文件 (' + files.length + ') · ' + hash.slice(0, 7);
  if (files.length === 0) { detailsList.innerHTML = '<div class="file" style="opacity:.6">无变更文件（可能为根提交或合并提交）</div>'; detailsEl.classList.add('show'); return; }
  const html = [];
  for (const f of files) {
    html.push('<div class="file" data-hash="', esc(hash), '" data-path="', esc(f.path), '" data-hasparent="', hasParent, '"><span class="dot" style="color:var(--vscode-', f.themeColor.replace(/\\./g, '-'), ')">', esc(f.statusLabel), '</span><span class="nm">', esc(f.path), '</span></div>');
  }
  detailsList.innerHTML = html.join('');
  detailsEl.classList.add('show');
}

window.addEventListener('message', function (e) {
  const m = e.data;
  if (m.type === 'log/graphData') {
    model = { rows: m.payload.rows, maxLanes: m.payload.maxLanes, hasMore: m.payload.hasMore, repoRoot: m.payload.repoRoot };
    scope = m.payload.scope; repoEl.textContent = m.payload.repoRoot; repoEl.title = m.payload.repoRoot;
    // 图全量重置 → CI 缓存随之失效（提交集合被替换）。
    for (const k in ciByHash) delete ciByHash[k];
    ciRequested.clear(); ciPending.clear();
    if (ciReqTimer) { clearTimeout(ciReqTimer); ciReqTimer = null; }
    hideTip();
    renderedFirst = -1; renderedLast = -1; viewport.scrollTop = 0; fetching = false; spinnerEl.style.display = 'none';
    if (!model.rows.some(function (r) { return r.hash === selectedHash; })) selectedHash = null;
    scheduleRender();
  } else if (m.type === 'log/appendData') {
    model.rows = model.rows.concat(m.payload.rows);
    model.maxLanes = Math.max(model.maxLanes, m.payload.maxLanes);
    model.hasMore = m.payload.hasMore; fetching = false; spinnerEl.style.display = 'none';
    renderedFirst = -1; scheduleRender();
  } else if (m.type === 'log/commitFiles') {
    renderDetails(m.payload.hash, m.payload.files);
  } else if (m.type === 'log/busy') {
    spinnerEl.style.display = m.payload.busy ? 'block' : 'none';
  } else if (m.type === 'log/ciMeta') {
    ciMeta = { available: !!m.payload.available, needsSignIn: !!m.payload.needsSignIn, error: m.payload.error || '' };
    renderCiMeta();
    renderedFirst = -1; // 强制重绘可见行（CI 槽位/登录提示出现或消失）
    scheduleRender();
  } else if (m.type === 'log/ciData') {
    const map = m.payload.map;
    let touched = false;
    for (const h in map) { ciByHash[h] = map[h]; ciRequested.add(h); touched = true; }
    if (touched) {
      renderedFirst = -1; scheduleRender(); // 就地重绘可见行图标
      // 数据到达后重锚开启中的 Tooltip（图标新增/pending→终态变化）。
      requestAnimationFrame(function () {
        if (tipHash && ciTipEl.classList.contains('show')) {
          const el = rowsEl.querySelector('[data-ci="' + tipHash.replace(/[^a-f0-9]/gi, '') + '"]');
          if (el) { buildTip(ciByHash[tipHash]); positionTip(el.getBoundingClientRect()); }
          else hideTip();
        }
      });
    }
  }
});

function updateWidthClass() {
  const w = viewport.clientWidth;
  viewport.classList.toggle('narrow', w < 360);
}
new ResizeObserver(updateWidthClass).observe(viewport);
updateWidthClass();

vscode.postMessage({ type: 'log/requestState' });
</script>
</body>
</html>`;
	}
}

/** 变更文件状态 → gitDecoration 主题色 id（与原 log-tree 的 fileIconColor 语义一致）。 */
function fileIconColor(status: string): string {
	if (status.startsWith('A')) {
		return 'gitDecoration.addedResourceForeground';
	}
	if (status.startsWith('D')) {
		return 'gitDecoration.deletedResourceForeground';
	}
	if (status.startsWith('R') || status.startsWith('C')) {
		return 'gitDecoration.renamedResourceForeground';
	}
	return 'gitDecoration.modifiedResourceForeground';
}
