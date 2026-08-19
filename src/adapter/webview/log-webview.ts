import * as crypto from 'crypto';
import * as vscode from 'vscode';
import type { GitRepositoryService } from '../git-repository-service';
import { parseNameStatus, statusLabel, parseShortStat } from '../../engine/log/commit-files';
import { applyClientFilters, toClientFilter, type LogFilter } from '../../engine/log/log-filter';
import { DEFAULT_LANE_PALETTE } from '../../engine/log/graph-color';
import { computeGraphLayout, maxLanes } from '../../engine/log/graph-layout';
import { getBaseStyles } from './shared-styles';
import { parseLogLines } from '../../engine/log/log-line';
import { buildLogArgs, type LogScope } from '../../engine/log/log-query';
import { buildFileTree } from '../../engine/tree/file-tree';
import { formatRelative, formatAbsolute } from '../../engine/log/format-time';
import { commitWebUrl } from '../../engine/ci/remote-parser';
import type { GitHubCiService } from '../ci/github-ci-service';
import type {
	CiMetaVM,
	CiStatusVM,
	CommitDetailVM,
	GraphRowVM,
	LogCommitFileItem,
	LogGraphState,
	LogHostToWebviewMessage,
	LogWebviewToHostMessage,
	RefChip,
} from '../../shared/protocol';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 悬浮详情正文上限：截断以控 1000 行 payload（超限加省略号，正文另有滚动区兜底展示）。 */
const BODY_CAP = 2000;
function capBody(b: string): string {
	const t = (b ?? '').replace(/\s+$/, '');
	return t.length > BODY_CAP ? `${Array.from(t).slice(0, BODY_CAP).join('')}…` : t;
}

/** 单页拉取的 commit 数（滚动触底增量加载下一页）。 */
const PAGE = 1000;

/** per-commit 操作 → 既有命令 id（webview 右键菜单 → host 重调用，handler 仅需 hash）。 */
const COMMIT_MENU: ReadonlyArray<{ readonly label: string; readonly command: string }> = [
	{ label: 'Copy Hash', command: 'hyperGit.copyCommitHash' },
	{ label: 'Cherry-Pick Commit', command: 'hyperGit.cherryPick' },
	{ label: 'Revert Commit', command: 'hyperGit.revertCommit' },
	{ label: 'Drop Commit', command: 'hyperGit.dropCommit' },
	{ label: 'Fixup Commit', command: 'hyperGit.fixupCommit' },
	{ label: 'Create Branch from Commit…', command: 'hyperGit.createBranchFromCommit' },
	{ label: 'Create Tag from Commit…', command: 'hyperGit.createTagFromCommit' },
	{ label: 'Show Branches Containing Commit', command: 'hyperGit.showContainingBranches' },
	{ label: 'Reset Current Branch to Here…', command: 'hyperGit.resetToHere' },
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
 * 自计算 lane 布局（engine/log/graph-layout）→ 渲染彩色泳道；host 侧单次 `git log --author-date-order`
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
		// 活跃仓库切换（issue #107）：host 级过滤条件是旧仓库语境的产物，跨仓库无意义 → 清空；
		// 图数据重拉由上方 onDidChange 订阅驱动，无需额外处理。
		this.disposables.push(service.onDidChangeRepository(() => { this.filter = {}; }));
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
			case 'log/retry':
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
					msg.payload.status,
					msg.payload.oldPath,
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
			case 'log/showCommitDetail':
				void this.showCommitDetail(msg.payload.hash);
				break;
			case 'log/selectRepo':
				// 复用 postMessage → 原生交互 → executeCommand 通路（同 handleCommitMenu 形态）。
				void vscode.commands.executeCommand('hyperGit.selectRepository');
				break;
		}
	}

	/** 组装提交详情 VM（基础字段 + 预格式化时间 + 变更统计 + GitHub URL），下发给 webview 浮层渲染。 */
	private async showCommitDetail(hash: string): Promise<void> {
		if (!this.service.repo) {
			this.post({ type: 'log/commitDetail', payload: { vm: null } });
			return;
		}
		try {
			// %x00 分隔，与 LOG_GRAPH_FORMAT 同范式；单条 git show 开销极小。
			const fmt = '%H%x00%s%x00%b%x00%an%x00%ae%x00%aI%x00%cn%x00%cI%x00%P';
			const raw = await this.service.execGit(['show', '-s', `--format=${fmt}`, hash]);
			const f = raw.split('\0');
			if (f.length < 9 || !f[0]) {
				this.post({ type: 'log/commitDetail', payload: { vm: null } });
				return;
			}
			const [fullHash, subject, body, authorName, authorEmail, authorDate, committerName, committerDate, parentsRaw] = f;
			const stat = parseShortStat(
				await this.service.execGit(['diff-tree', '--no-commit-id', '--shortstat', '-r', '--root', hash]),
			);
			const remote = this.ciService.getGitHubRemote();
			const cappedBody = body.length > 4000 ? `${body.slice(0, 4000)}…` : body.replace(/\s+$/, '');
			const vm: CommitDetailVM = {
				hash: fullHash,
				shortHash: fullHash.slice(0, 7),
				subject,
				body: cappedBody,
				authorName,
				authorEmail,
				authorDate,
				authorDateRel: formatRelative(authorDate),
				authorDateAbs: formatAbsolute(authorDate),
				committerName,
				committerDate,
				committerDateRel: formatRelative(committerDate),
				committerDateAbs: formatAbsolute(committerDate),
				parents: parentsRaw ? parentsRaw.trim().split(/\s+/).filter(Boolean) : [],
				stat,
				githubUrl: remote ? commitWebUrl(remote, fullHash) : undefined,
			};
			this.post({ type: 'log/commitDetail', payload: { vm } });
		} catch {
			this.post({ type: 'log/commitDetail', payload: { vm: null } });
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
			multiRepo: this.service.listRepositories().length > 1,
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
				authorEmail: s.raw.authorEmail,
				authorDate: s.raw.authorDate,
				committerName: s.raw.committerName,
				committerDate: s.raw.committerDate,
				body: capBody(s.raw.body),
				chips: chips.get(s.raw.hash) ?? [],
				layout: layout[i],
			}));
			return { rows, maxLanes: maxLanes(layout), hasMore: raws.length === PAGE };
		} catch (e) {
			// 失败时以 webview 内错误态呈现（带 Retry），而非模态弹窗——用户可即时重试。
			this.post({ type: 'log/error', payload: { message: errMsg(e) } });
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
			// path 取干净新路径（供 data-path/建树/端点定位）；rename/copy 的 "old → new" 展示由 webview 端用 oldPath 拼出。
			const files: LogCommitFileItem[] = changes.map((c) => ({
				status: c.status,
				statusLabel: statusLabel(c.status),
				path: c.path,
				oldPath: c.oldPath,
				themeColor: fileIconColor(c.status),
			}));
			// 用干净新路径建目录树（重命名归位到新目录）；叶子经 fileIndex 回指展示用 files[i]。
			const tree = buildFileTree(changes.map((c) => c.path));
			this.post({ type: 'log/commitFiles', payload: { hash, files, tree } });
		} catch {
			this.post({ type: 'log/commitFiles', payload: { hash, files: [], tree: [] } });
		}
	}

	private async handleCommitMenu(hash: string): Promise<void> {
		const nodeLike: LogCommitNode = { kind: 'commit', commit: { hash, message: '', parents: [] } };
		const items = COMMIT_MENU.map((m) => ({ label: m.label, command: m.command }));
		const pick = await vscode.window.showQuickPick(items, { placeHolder: `Commit ${hash.slice(0, 7)}` });
		if (!pick) {
			return;
		}
		await vscode.commands.executeCommand(pick.command, nodeLike);
	}

	// ─── HTML 渲染 ──────────────────────────────────────────────────────────────

	private renderHtml(): string {
		const nonce = crypto.randomBytes(16).toString('base64');
		const laneFallback = JSON.stringify(DEFAULT_LANE_PALETTE);
		const csp = ['default-src \'none\'', 'style-src \'unsafe-inline\'', `script-src 'nonce-${nonce}'`].join('; ');
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
${getBaseStyles()}
:root { --hg-row: 24px; --hg-lane: 14px; }
* { box-sizing: border-box; }
body { margin: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-sideBar-background); display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
.toolbar { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-bottom: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.25)); }
.seg { display: inline-flex; border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; overflow: hidden; }
.seg button { background: transparent; color: var(--vscode-foreground); border: none; padding: 2px 9px; font-size: 11px; cursor: pointer; opacity: 0.65; transition: background-color .12s ease, opacity .12s ease; }
.seg button:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); opacity: 0.9; }
.seg button.active { background: var(--vscode-inputOption-activeBackground, var(--vscode-button-background)); color: var(--vscode-inputOption-activeForeground, var(--vscode-button-foreground)); opacity: 1; }
.repo { margin-left: auto; font-size: 10px; opacity: 0.55; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 多仓库态：仓库名升级为可点击切换按钮（Git Graph 形态）；单仓库保持纯文本观感。 */
button.repo { background: transparent; color: var(--vscode-foreground); border: none; padding: 1px 6px; border-radius: 3px; cursor: pointer; }
button.repo.switchable:hover { opacity: 1; background: var(--vscode-list-hoverBackground); }
button.repo:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
#viewport { flex: 1; overflow-y: auto; overflow-x: hidden; position: relative; outline: none; }
#spacer { position: relative; }
#rows { position: absolute; left: 0; right: 0; }
.row { display: flex; align-items: center; height: var(--hg-row); padding-right: 8px; cursor: pointer; white-space: nowrap; }
.row:hover { background: var(--vscode-list-hoverBackground); }
.row.selected { background: var(--vscode-list-activeSelectionBackground, var(--vscode-list-inactiveSelectionBackground)); }
.row svg.graph { flex: 0 0 auto; display: block; }
.row svg.graph .node { stroke: var(--vscode-sideBar-background); stroke-width: 1.5; }
.row svg.graph .node-dot { stroke: var(--vscode-sideBar-background); stroke-width: 1; }
.row.selected svg.graph .node { stroke: var(--vscode-focusBorder); stroke-width: 2.2; }
.row.selected svg.graph .node-ring { stroke: var(--vscode-focusBorder); stroke-width: 2; }
.subject { flex: 1 1 auto; min-width: 0; overflow: hidden; display: flex; align-items: center; gap: 6px; }
.msg { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.merge { flex: 0 0 auto; opacity: 0.6; font-size: 10px; padding: 0 2px; }
/* 引用胶囊：实心圆角 pill + 图标前缀，底色跟随本行泳道色（内联 style 注入），类型靠图标区分（对齐官方 GRAPH 视图）。 */
.chips { display: inline-flex; gap: 4px; flex: 0 0 auto; min-width: 0; overflow: hidden; }
.chip { display: inline-flex; align-items: center; gap: 3px; height: 16px; line-height: 16px; font-size: 10px; font-weight: 600; padding: 0 7px 0 6px; border-radius: 8px; white-space: nowrap; max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.chip .chip-ico { flex: 0 0 auto; width: 11px; height: 11px; display: inline-flex; }
.chip .chip-ico svg { width: 11px; height: 11px; display: block; }
.chip .chip-nm { overflow: hidden; text-overflow: ellipsis; }
.author { flex: 0 0 auto; font-size: 11px; opacity: 0.7; max-width: 110px; overflow: hidden; text-overflow: ellipsis; padding-left: 8px; }
.date { flex: 0 0 auto; font-size: 11px; opacity: 0.55; padding-left: 8px; }
#viewport.narrow .author, #viewport.narrow .date { display: none; }
#details { flex: 0 0 auto; max-height: 38%; overflow-y: auto; border-top: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.25)); display: none; }
#details.show { display: block; }
#details .dh { position: sticky; top: 0; display: flex; align-items: center; gap: 6px; background: var(--vscode-sideBar-background); padding: 4px 8px; font-size: 11px; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.15)); }
#details .dh #details-title { flex: 1 1 auto; }
.dh-close { flex: 0 0 auto; background: transparent; border: none; color: var(--vscode-descriptionForeground); cursor: pointer; font-size: 16px; line-height: 1; padding: 0 4px; border-radius: var(--hg-radius-control); }
.dh-close:hover { color: var(--vscode-foreground); background: var(--vscode-list-hoverBackground); }
.dh-close:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }
#details .file { display: flex; align-items: center; gap: 6px; padding: 2px 10px; font-size: 12px; cursor: pointer; }
#details .file:hover { background: var(--vscode-list-hoverBackground); }
#details .file .dot { font-size: 13px; line-height: 1; }
#details .file .nm { overflow: hidden; text-overflow: ellipsis; }
#empty, #error { padding: 28px 16px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 12px; }
#empty .empty-icon { font-size: 30px; opacity: 0.4; margin-bottom: 8px; }
.empty-title { font-size: 13px; color: var(--vscode-foreground); margin-bottom: 3px; }
.empty-hint { font-size: 11px; }
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
#ci-tip .g-skipped, #ci-tip .g-unknown { color: var(--vscode-descriptionForeground, #8b949e); }
/* ── 提交详情悬浮卡（cursor-anchored；editorHoverWidget 语义令牌，与 CI 浮层同款视觉语言）── */
#commit-tip { position: fixed; z-index: 50; display: none; max-width: 480px; min-width: 300px; max-height: 80vh; overflow: hidden; background: var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background)); color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground)); border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-editorWidget-border, rgba(128,128,128,.3))); border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,.4); font-size: 12px; }
#commit-tip.show { display: flex; flex-direction: column; }
#commit-tip .ct-scroll { overflow-y: auto; max-height: 80vh; padding: 12px 14px; }
#commit-tip .ct-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
#commit-tip .ct-avatar { flex: 0 0 auto; width: 26px; height: 26px; border-radius: 50%; background: var(--vscode-badge-background, rgba(128,128,128,.25)); color: var(--vscode-badge-foreground, var(--vscode-foreground)); display: inline-flex; align-items: center; justify-content: center; }
#commit-tip .ct-avatar svg { width: 16px; height: 16px; opacity: 0.85; }
#commit-tip .ct-who { display: flex; flex-direction: column; min-width: 0; }
#commit-tip .ct-author { font-weight: 600; font-size: 13px; }
#commit-tip .ct-time { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 1px; }
#commit-tip .ct-msg { margin-bottom: 10px; }
#commit-tip .ct-subj { font-size: 13px; font-weight: 600; line-height: 1.4; word-break: break-word; }
#commit-tip .ct-body { margin-top: 6px; white-space: pre-wrap; word-break: break-word; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; line-height: 1.5; opacity: 0.9; }
#commit-tip .ct-refs-wrap { margin-bottom: 10px; display: flex; flex-direction: column; gap: 5px; }
#commit-tip .ct-sec { display: flex; gap: 8px; align-items: baseline; font-size: 12px; }
#commit-tip .ct-sec .ct-k { flex: 0 0 66px; color: var(--vscode-descriptionForeground); font-size: 10px; text-transform: uppercase; letter-spacing: .3px; }
#commit-tip .ct-sec .ct-v { flex: 1 1 auto; min-width: 0; word-break: break-word; }
#commit-tip .ct-refs { display: flex; flex-wrap: wrap; gap: 4px; }
/* 浮层内引用胶囊完整显示（覆盖行内 .chip 的 max-width/省略号截断）：换行不截断，空间由浮层承载。 */
#commit-tip .chip { max-width: none; }
#commit-tip .chip .chip-nm { overflow: visible; text-overflow: clip; white-space: normal; word-break: break-all; }
#commit-tip .ct-dim { color: var(--vscode-descriptionForeground); }
#commit-tip .ct-stat { display: flex; gap: 12px; padding: 8px 0; border-top: 1px solid var(--vscode-editorHoverWidget-border, rgba(128,128,128,.2)); border-bottom: 1px solid var(--vscode-editorHoverWidget-border, rgba(128,128,128,.2)); font-size: 12px; font-variant-numeric: tabular-nums; }
#commit-tip .ct-stat .files { color: var(--vscode-descriptionForeground); }
#commit-tip .ct-stat .ins { color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950); }
#commit-tip .ct-stat .del { color: var(--vscode-gitDecoration-deletedResourceForeground, #f14c4c); }
#commit-tip .ct-foot { display: flex; align-items: center; gap: 14px; margin-top: 10px; flex-wrap: wrap; }
#commit-tip .ct-sha { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; color: var(--vscode-descriptionForeground); word-break: break-all; }
#commit-tip .ct-gh { color: var(--vscode-textLink-foreground); cursor: pointer; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
#commit-tip .ct-gh:hover { text-decoration: underline; }
#commit-tip .ct-gh:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; border-radius: 2px; }
#commit-tip .ct-gh svg { width: 13px; height: 13px; }
/* ── 变更文件目录树（详情面板 Group By Directory 形态）── */
#details .dh .seg { flex: 0 0 auto; }
#details .tree-dir { display: flex; align-items: center; gap: 6px; padding: 2px 10px; font-size: 12px; cursor: pointer; user-select: none; }
#details .tree-dir:hover { background: var(--vscode-list-hoverBackground); }
#details .tree-dir .tree-twist { flex: 0 0 12px; text-align: center; font-size: 10px; opacity: 0.8; }
#details .tree-dir .tree-name { color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; }
</style>
</head>
<body>
<div class="toolbar">
  <span class="seg" role="group" aria-label="Commit scope">
    <button id="scope-all" class="active" aria-pressed="true">All</button>
    <button id="scope-current" aria-pressed="false">Current</button>
    <button id="scope-checkpointer" aria-pressed="false" title="Show internal checkpoint (auto-snapshot) commits">Checkpoints</button>
  </span>
  <button class="repo" id="repo" type="button"></button>
  <button id="ci-signin" class="ci-signin" title="Sign in to GitHub to view CI status">Sign In to GitHub</button>
</div>
<div id="viewport" tabindex="0" role="tree" aria-label="Commit graph">
  <div id="spacer"><div id="rows"></div></div>
  <div id="empty"><div class="empty-icon" aria-hidden="true">⌥</div><div class="empty-title">No Commits</div><div class="empty-hint">No commits match the current scope or filter.</div></div>
  <div id="error" style="display:none"><div class="empty-title">Failed to Load Commits</div><div class="empty-hint" id="error-msg"></div><button class="hg-btn hg-btn--sm" id="retry-btn" style="margin-top:8px">Retry</button></div>
  <div id="spinner">Loading…</div>
</div>
<div id="details"><div class="dh" id="details-head"><span id="details-title"></span><span class="seg" role="group" aria-label="Changed files view mode"><button id="dmode-flat" class="active" aria-pressed="true" title="Flat list">List</button><button id="dmode-tree" aria-pressed="false" title="Group by directory">Tree</button></span><button class="dh-close" id="details-close" title="Close" aria-label="Close details">×</button></div><div id="details-list"></div></div>
<div id="ci-tip" role="dialog" aria-label="CI check details"></div>
<div id="commit-tip" role="tooltip" aria-label="Commit details"></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const LANE_FALLBACK = ${laneFallback};
// 启动期解析泳道色：优先主题 --vscode-charts-* 令牌（深/浅主题自适应），缺失或与其它 lane 撞色时
// 回落 DEFAULT_LANE_PALETTE 原始 distinct hex，保底相邻 lane 可区分（对齐 graph-color 设计注释）。
const PALETTE = (function () {
	const cs = getComputedStyle(document.body);
	const hues = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'cyan', 'orange'];
	const resolved = hues.map(function (hue, i) {
		const v = cs.getPropertyValue('--vscode-charts-' + hue).trim();
		return v || LANE_FALLBACK[i];
	});
	const seen = Object.create(null);
	return resolved.map(function (c, i) {
		const key = String(c).toLowerCase();
		if (seen[key] === undefined) { seen[key] = true; return c; }
		return LANE_FALLBACK[i];
	});
})();
const ROW_H = 24, LANE_W = 14, NODE_R = 4, GUTTER = 10, OVERSCAN = 8, LOAD_THRESHOLD = 40;
/** scope 白名单兜底：仅接受三态，否则回退默认 'all'（兼容未来废弃的持久化值）。 */
function normalizeScope(v) { return v === 'all' || v === 'current' || v === 'checkpointer' ? v : 'all'; }
const persisted = vscode.getState() || {};
let selectedHash = persisted.selectedHash || null;
let scope = normalizeScope(persisted.scope);
let detailsMode = persisted.dmode === 'tree' ? 'tree' : 'flat';
const dcollapsed = new Set(persisted.dcollapsed || []);
function persist() { vscode.setState({ selectedHash: selectedHash, scope: scope, dmode: detailsMode, dcollapsed: Array.from(dcollapsed) }); }
let model = { rows: [], maxLanes: 0, hasMore: false, repoRoot: '', multiRepo: false };
let renderedFirst = -1, renderedLast = -1, fetching = false;
// ── CI 状态（懒加载、仅取可见行；ciByHash 稳定缓存、ciRequested 去重、ciPending 防抖批量）──
// ciByHash 跨 graphData 刷新保留（CI 状态以不可变 hash 为键），杜绝每次 git 状态变化引发的重拉闪烁。
const ciByHash = Object.create(null);
const ciRequested = new Set();
const ciPending = new Set();
let ciMeta = { available: false, needsSignIn: false, error: '' };
let ciReqTimer = null;
// 准实时刷新：仅对可见行中 pending（运行中）状态定时复拉（host 侧 30s TTL 网络门控），终态不再变。
let ciPendingRefreshTimer = null;
let ciRefreshing = false;
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
const detailsList = document.getElementById('details-list');
const detailsTitleEl = document.getElementById('details-title');
const detailsCloseEl = document.getElementById('details-close');
const dmodeFlatEl = document.getElementById('dmode-flat');
const dmodeTreeEl = document.getElementById('dmode-tree');
const commitTipEl = document.getElementById('commit-tip');
let ctHash = null, ctShowT = null, ctHideT = null; // 悬停详情：当前 hash + 显示/隐藏防抖计时器。
let curDetailHash = null, curDetailFiles = [], curDetailTree = [];
const errorEl = document.getElementById('error');
const errorMsgEl = document.getElementById('error-msg');
const retryBtnEl = document.getElementById('retry-btn');

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
// 仓库根路径 → basename（多仓库态按钮文案；尾分隔符安全）。
function repoBasename(p) { const parts = String(p).split(/[\\\\/]/).filter(Boolean); return parts.pop() || String(p); }
// 引用胶囊图标（内联 SVG，仿 codicon git-branch / cloud / tag；fill=currentColor 继承 chip 前景色）。
// 项目未引入 codicon 字体（localResourceRoots=[]、CSP 无 font-src），故图标一律内联，与 ciGlyph 一致。
const ICO_BRANCH = '<svg class="chip-ico" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M9.5 3.25a2.25 2.25 0 1 1-3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 1 1 9.5 3.25zm-4 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0zm.75 8.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z"/></svg>';
const ICO_CLOUD = '<svg class="chip-ico" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M4.7 6.04A3.5 3.5 0 0 1 11.4 6.5h.35a2.75 2.75 0 0 1 .25 5.49l-.13.01H4.5a3 3 0 0 1-.3-5.96zM8 5a2.5 2.5 0 0 0-2.45 2.01l-.1.5-.5.06A2 2 0 0 0 4.5 11.5h7.3a1.75 1.75 0 0 0 .05-3.5l-.1-.01h-1.02l-.12-.63A2.5 2.5 0 0 0 8 5z"/></svg>';
const ICO_TAG = '<svg class="chip-ico" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M2 2.75A.75.75 0 0 1 2.75 2h5.19c.33 0 .65.13.88.37l4.81 4.8a1.25 1.25 0 0 1 0 1.77l-4.69 4.69a1.25 1.25 0 0 1-1.77 0l-4.8-4.81A1.25 1.25 0 0 1 2 7.94V2.75zm1.5.75v4.44l4.69 4.69 4.44-4.44L7.94 3.5H3.5zm1.75 1a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5z"/></svg>';
function chipIcon(kind) { return kind === 'remoteBranch' ? ICO_CLOUD : kind === 'tag' ? ICO_TAG : ICO_BRANCH; }
// 提交详情浮层图标（内联 SVG，fill=currentColor 继承前景色）。
const ICO_PERSON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 1.5c-2.5 0-6 1.25-6 3.5V14h12v-1c0-2.25-3.5-3.5-6-3.5z"/></svg>';
const ICO_GH = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8 .2a8 8 0 0 0-2.53 15.6c.4.07.55-.17.55-.38l-.01-1.34c-2.23.49-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.83-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.52.56.83 1.28.83 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.2c0 .21.15.46.55.38A8 8 0 0 0 8 .2z"/></svg>';
function laneColor(i) { return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length]; }
// 实心胶囊前景色：按底色相对亮度择深/白字（WCAG 阈值 0.6），保证任意泳道底色上文字均可读。解析失败回落白字。
function onColor(bg) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(bg).trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#1e1e1e' : '#ffffff';
}
function colX(c) { return c * LANE_W + LANE_W / 2; }
/** 本行实际绘制的最右列号（node + 各边 from/to 的最大值）——行宽据此自适应，消除「全局 maxLanes 撑宽」的留白。 */
function rowMaxCol(row) { const L = row.layout; let m = L.node.col; for (const e of L.incoming) { if (e.fromCol > m) m = e.fromCol; if (e.toCol > m) m = e.toCol; } for (const e of L.outgoing) { if (e.fromCol > m) m = e.fromCol; if (e.toCol > m) m = e.toCol; } for (const e of L.passThrough) { if (e.fromCol > m) m = e.fromCol; if (e.toCol > m) m = e.toCol; } return m; }
function fmtDate(iso) { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; const m = String(d.getMonth() + 1).padStart(2, '0'); const da = String(d.getDate()).padStart(2, '0'); return d.getFullYear() + '-' + m + '-' + da; }

function rowSvg(row) {
  const L = row.layout;
  const cy = ROW_H / 2;
  const W = (rowMaxCol(row) + 1) * LANE_W + GUTTER;
  const p = ['<svg class="graph" width="', W, '" height="', ROW_H, '" viewBox="0 0 ', W, ' ', ROW_H, '" xmlns="http://www.w3.org/2000/svg">'];
  // 泳道连线用三次贝塞尔平滑过渡（对齐官方 GRAPH 视图）：控制点取 y 中点、各自锚原 x；
  // fromCol===toCol 时自动退化为直线（直行/贯穿/dangling 竖段无需特判）。fill="none" 为 path 必需，避免闭合填充。
  const seg = (e) => 'fill="none" stroke="' + laneColor(e.colorIdx) + '" stroke-width="1.6" stroke-linecap="round"';
  for (const e of L.passThrough) p.push('<path d="', edgePath(colX(e.fromCol), 0, colX(e.toCol), ROW_H), '" ', seg(e), '/>');
  for (const e of L.incoming) p.push('<path d="', edgePath(colX(e.fromCol), 0, colX(e.toCol), cy), '" ', seg(e), '/>');
  for (const e of L.outgoing) {
    const y2 = e.kind === 'dangling' ? ROW_H * 0.78 : ROW_H;
    const op = e.kind === 'dangling' ? ' opacity="0.45"' : '';
    p.push('<path d="', edgePath(colX(e.fromCol), cy, colX(e.toCol), y2), '"', op, ' ', seg(e), '/>');
  }
  // 节点：当前 HEAD 行绘「空心环 + 内点」（双环高亮，对齐官方），普通行绘实心点。环 fill=none 让贯穿竖线透过可见。
  const nx = colX(L.node.col), col = laneColor(L.node.colorIdx);
  if (isHeadRow(row)) {
    // 环/内点不挂 .node 类：避免通用 .node { stroke: sideBar-background } 覆盖内联 lane 色 stroke（SVG presentation 属性优先级低于 CSS）。
    p.push('<circle class="node-ring" cx="', nx, '" cy="', cy, '" r="', NODE_R + 1.5, '" fill="none" stroke="', col, '" stroke-width="1.6"/>');
    p.push('<circle class="node-dot" cx="', nx, '" cy="', cy, '" r="', NODE_R - 1.2, '" fill="', col, '"/>');
  } else {
    p.push('<circle class="node" cx="', nx, '" cy="', cy, '" r="', NODE_R, '" fill="', col, '"/>');
  }
  p.push('</svg>');
  return p.join('');
}
/** S 形三次贝塞尔：控制点在 y 中点、各自锚原 x。fromCol===toCol 时退化为竖直直线。 */
function edgePath(x1, y1, x2, y2) {
  const my = (y1 + y2) / 2;
  return 'M' + x1 + ' ' + y1 + ' C' + x1 + ' ' + my + ' ' + x2 + ' ' + my + ' ' + x2 + ' ' + y2;
}
/** 当前 HEAD 行判定：chips 中有 detached HEAD（kind==='head'）或 HEAD 指向的本地分支（isHeadTarget）。 */
function isHeadRow(row) {
  const cs = row.chips || [];
  for (const c of cs) { if (c.kind === 'head' || c.isHeadTarget) return true; }
  return false;
}

function chipsHtml(row) {
  if (!row.chips || row.chips.length === 0) return '';
  // 对齐官方 GRAPH：胶囊实心底色跟随本行泳道色（node.colorIdx），类型靠图标（分支/云/tag）区分而非颜色；
  // 文字色按底色亮度自适应，保证可读。不加原生 title：引用明细统一由编辑器区 Commit 详情面板展示。
  const bg = laneColor(row.layout.node.colorIdx);
  const fg = onColor(bg);
  const parts = ['<span class="chips">'];
  for (const c of row.chips) {
    const cls = 'chip ' + c.kind + (c.isHeadTarget ? ' head-target' : '');
    parts.push('<span class="', cls, '" style="background:', bg, ';color:', fg, '">', chipIcon(c.kind), '<span class="chip-nm">', esc(c.name), '</span></span>');
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
  const a11y = ci.state === 'success' ? 'CI passed ' + ci.passed + '/' + ci.total
    : ci.state === 'failure' ? 'CI failed, ' + failed + '/' + ci.total + ' checks failing'
    : 'CI running ' + ci.passed + '/' + ci.total;
  return '<span class="ci ci-' + ci.state + '" data-ci="' + esc(row.hash) + '" tabindex="0" role="button" aria-label="' + esc(a11y) + '">' + ciGlyph(ci.state) + '</span>';
}

function rowHtml(row, idx) {
  const sel = row.hash === selectedHash ? ' selected' : '';
  const merge = row.isMerge ? '<span class="merge" title="Merge commit">⇠</span>' : '';
  // 列顺序对齐官方 GRAPH：泳道图 → message → 引用胶囊 → author → date → CI。chips 作为 message 右侧后缀。
  return '<div class="row' + sel + '" data-i="' + idx + '" data-hash="' + esc(row.hash) + '" role="treeitem" aria-selected="' + (sel !== '') + '">'
    + rowSvg(row)
    + '<span class="subject"><span class="msg">' + esc(row.subject) + '</span>' + merge + chipsHtml(row) + '</span>'
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
  errorEl.style.display = 'none';
  document.getElementById('scope-all').classList.toggle('active', scope === 'all');
  document.getElementById('scope-current').classList.toggle('active', scope === 'current');
  document.getElementById('scope-checkpointer').classList.toggle('active', scope === 'checkpointer');
  document.getElementById('scope-all').setAttribute('aria-pressed', String(scope === 'all'));
  document.getElementById('scope-current').setAttribute('aria-pressed', String(scope === 'current'));
  document.getElementById('scope-checkpointer').setAttribute('aria-pressed', String(scope === 'checkpointer'));
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
    if (!h || (h in ciByHash) || ciRequested.has(h) || ciPending.has(h)) continue;
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

/**
 * CI 数据到达后**就地**更新可见行图标：只改受影响行的 .ci 槽位（replaceChild/appendChild），
 * 绝不重建整行/整页（reduce-reflows），从根源消除「每次 ciData 触发 innerHTML 重写」的全列闪烁。
 * 状态类未变（如 pending 复拉、计数更新）时保留原元素，旋转动画不重启、零重绘。
 */
function applyCiData(map) {
  const changed = Object.keys(map);
  if (changed.length === 0) return;
  for (const h of changed) {
    ciByHash[h] = map[h];
    ciRequested.add(h);
  }
  // 只遍历已渲染的可见行，命中受影响 hash 即就地标定其 .ci 槽位。
  const kids = rowsEl.children;
  for (let i = 0; i < kids.length; i++) {
    const rowEl = kids[i];
    const h = rowEl.getAttribute('data-hash');
    if (!(h in map)) continue;
    const slot = rowEl.querySelector('.ci');
    const ci = ciByHash[h];
    const wantCls = ci && ci.state !== 'unknown' ? 'ci-' + ci.state : 'ci-empty';
    // 状态类未变（如 pending 复拉、计数更新）：保留元素，旋转动画不重启、零重绘。
    if (slot && slot.classList.contains(wantCls)) continue;
    const fresh = ciSlotHtml({ hash: h });
    if (slot && slot.outerHTML === fresh) continue;
    const tmp = document.createElement('div');
    tmp.innerHTML = fresh;
    const newSlot = tmp.firstElementChild;
    if (slot) {
      if (newSlot) rowEl.replaceChild(newSlot, slot);
      else rowEl.removeChild(slot);
    } else if (newSlot) {
      rowEl.appendChild(newSlot);
    }
  }
}

/** 准实时刷新：仅对可见行中 pending（运行中）状态的提交定时复拉，转终态后停拉。host 30s TTL 网络门控。 */
function ensurePendingRefresh() {
  if (ciPendingRefreshTimer) return;
  ciPendingRefreshTimer = setInterval(schedulePendingRefresh, 20000);
}
function stopPendingRefresh() {
  if (ciPendingRefreshTimer) { clearInterval(ciPendingRefreshTimer); ciPendingRefreshTimer = null; }
}
function schedulePendingRefresh() {
  if (!ciMeta.available || ciRefreshing) return;
  const total = model.rows.length;
  if (total === 0 || renderedFirst < 0) return;
  const pending = [];
  for (let i = renderedFirst; i < renderedLast && i < total; i++) {
    const h = model.rows[i] && model.rows[i].hash;
    const ci = h && ciByHash[h];
    if (ci && ci.state === 'pending') pending.push(h);
  }
  if (pending.length === 0) return;
  ciRefreshing = true;
  vscode.postMessage({ type: 'log/requestCi', payload: { hashes: pending } });
}

// ── CI Tooltip（自定义浮层：列明细 + 失败原因 + 跳转链接，仿 IDEA / GitHub）──
function tipGlyph(state) {
  const svg = (state === 'unknown' || state === 'skipped')
    ? '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M4 8h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
    : ciGlyph(state);
  // 必须包裹 .g-{state} 才能上色（绿=通过/红=失败/黄=运行中/灰=未知），否则继承前景色呈单色。
  return '<span class="g g-' + state + '">' + svg + '</span>';
}
function buildTip(ci) {
  const headState = ci.state === 'success' ? 'success' : ci.state === 'failure' ? 'failure' : 'pending';
  const headTxt = ci.state === 'success' ? ('All ' + ci.total + ' checks passed')
    : ci.state === 'failure' ? ((ci.total - ci.passed) + ' / ' + ci.total + ' checks failed')
    : ci.state === 'pending' ? ('Checks running ' + ci.passed + ' / ' + ci.total) : 'CI status unknown';
  // 失败项前置，悬停即可见未通过原因。
  const ordered = ci.checks.slice().sort(function (a, b) {
    return (a.state === 'failure' ? 0 : 1) - (b.state === 'failure' ? 0 : 1);
  });
  const parts = ['<div class="tip-h"><span class="g g-', headState, '">', ciGlyph(headState), '</span>', esc(headTxt), '</div><div class="tip-list">'];
  if (ordered.length === 0) parts.push('<div class="tip-row" style="opacity:.6;cursor:default">No check details</div>');
  for (const c of ordered) {
    const desc = (c.state === 'failure' && c.description) ? '<span class="desc">' + esc(c.description) + '</span>' : '';
    parts.push('<div class="tip-row" data-url="', esc(c.url || ''), '" role="link" tabindex="0">', tipGlyph(c.state), '<span class="nm">', esc(c.name), desc, '</span></div>');
  }
  parts.push('</div>');
  if (ci.url) parts.push('<div class="tip-foot"><a data-url="', esc(ci.url), '" role="link" tabindex="0">View on GitHub</a></div>');
  ciTipEl.innerHTML = parts.join('');
}
// 浮层定位（CI / 提交详情共用）：webview 是沙箱 iframe，position:fixed 相对 iframe 自身视口，
// 越界坐标会被 iframe 裁剪不可见。所有浮层统一「锚在鼠标处」——跟随光标、贴近用户视觉焦点；
// 边沿自动翻转（右→左、下→上），并钳制在视口内。
let cursorX = 0, cursorY = 0;
document.addEventListener('mousemove', function (e) { cursorX = e.clientX; cursorY = e.clientY; }, { passive: true });
function positionAtCursor(el) {
  el.style.display = 'flex';
  const w = el.offsetWidth, h = el.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight, pad = 6, gap = 8;
  // 横向：默认贴光标右侧；越右沿则翻到光标左侧（右沿紧邻光标）；仍越界收进视口。
  let left = cursorX + gap;
  if (left + w > vw - pad) left = cursorX - gap - w;
  if (left < pad) left = Math.max(pad, vw - pad - w);
  // 纵向：默认贴光标下方；越下沿则翻到光标上方（底边紧邻光标）；钳制视口。
  let top = cursorY + gap;
  if (top + h > vh - pad) top = Math.max(pad, cursorY - gap - h);
  if (top < pad) top = pad;
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}
// 键盘触发（无光标坐标）：锚在目标元素右侧，越界翻转。
function positionAtRect(el, rect) {
  el.style.display = 'flex';
  const w = el.offsetWidth, h = el.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight, pad = 6, gap = 8;
  let left = rect.right + gap;
  if (left + w > vw - pad) left = rect.left - gap - w;
  if (left < pad) left = Math.max(pad, vw - pad - w);
  let top = rect.top;
  if (top + h > vh - pad) top = Math.max(pad, vh - pad - h);
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}
function positionTip(rect) { rect ? positionAtRect(ciTipEl, rect) : positionAtCursor(ciTipEl); }
function scheduleShow(hash, iconEl) {
  clearTimeout(tipHideT);
  if (tipHash === hash && ciTipEl.classList.contains('show')) return;
  clearTimeout(tipShowT);
  tipShowT = setTimeout(function () {
    const ci = ciByHash[hash];
    if (!ci || ci.state === 'unknown') return;
    tipHash = hash;
    buildTip(ci);
    positionTip();
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
  persist();
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
  hideCommitTip(); // 进入 CI 图标：立即隐藏提交浮层并取消在途，二者互斥。
  scheduleShow(icon.getAttribute('data-ci'), icon);
});
rowsEl.addEventListener('mouseout', function (e) {
  const icon = e.target.closest && e.target.closest('.ci');
  if (!icon) return;
  overIcon = false;
  scheduleHide();
  // 离开 CI 图标但仍在同一行内（移回行体）：切回提交详情浮层。
  const to = e.relatedTarget;
  const r = to && to.closest && to.closest('.row');
  if (r && !(to.closest && to.closest('.ci'))) scheduleShowCommit(r.getAttribute('data-hash'));
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
    positionTip(icon.getBoundingClientRect()); // 键盘触发：无光标，锚图标 rect。
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
  // 双击 = 打开提交（选中 + 展开详情），与 VS Code「双击即打开」一致；提交操作菜单保留在右键与 Enter。
  const r = e.target.closest('.row'); if (!r) return;
  selectRow(r.getAttribute('data-hash'));
});
rowsEl.addEventListener('contextmenu', function (e) {
  const r = e.target.closest('.row'); if (!r) return;
  e.preventDefault();
  vscode.postMessage({ type: 'log/commitAction', payload: { op: 'menu', hash: r.getAttribute('data-hash') } });
});
function setScope(next) { if (scope !== next) { scope = next; persist(); vscode.postMessage({ type: 'log/setScope', payload: { scope: next } }); } }
document.getElementById('scope-all').addEventListener('click', function () { setScope('all'); });
document.getElementById('scope-current').addEventListener('click', function () { setScope('current'); });
document.getElementById('scope-checkpointer').addEventListener('click', function () { setScope('checkpointer'); });
// 仓库名按钮（多仓库态）：点击弹出原生仓库选择（host 复用 hyperGit.selectRepository）。
repoEl.addEventListener('click', function () {
  if (!model.multiRepo) { return; }
  vscode.postMessage({ type: 'log/selectRepo' });
});
detailsCloseEl.addEventListener('click', function () { detailsEl.classList.remove('show'); });
retryBtnEl.addEventListener('click', function () { errorEl.style.display = 'none'; spinnerEl.style.display = 'block'; vscode.postMessage({ type: 'log/retry' }); });
viewport.addEventListener('scroll', scheduleRender, { passive: true });
viewport.addEventListener('scroll', function () { if (tipHash) hideTip(); if (ctHash) hideCommitTip(); }, { passive: true });
viewport.addEventListener('keydown', function (e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
  else if (e.key === 'Home') { e.preventDefault(); if (model.rows.length) selectRow(model.rows[0].hash); }
  else if (e.key === 'End') { e.preventDefault(); if (model.rows.length) selectRow(model.rows[model.rows.length - 1].hash); }
  else if (e.key === 'Enter') { e.preventDefault(); if (selectedHash) vscode.postMessage({ type: 'log/commitAction', payload: { op: 'menu', hash: selectedHash } }); }
  else if (e.key === 'i' || e.key === 'I') {
    // 键盘可达（hover-vs-tap 保险）：对选中提交打开详情浮层；无光标，锚在选中行 rect。
    e.preventDefault();
    if (selectedHash) {
      const el = rowsEl.querySelector('.row.selected');
      ctHash = selectedHash;
      vscode.postMessage({ type: 'log/showCommitDetail', payload: { hash: selectedHash } });
      // 回包后由 message 处理器渲染；此处仅在有选中行时预锚定（光标未知 → 用 rect）。
      el && (window.__ctKeybRect = el.getBoundingClientRect());
    }
  }
  else if (e.key === 'Escape') { hideCommitTip(); }
});
detailsList.addEventListener('click', function (e) {
  const d = e.target.closest('.tree-dir');
  if (d) { toggleDetailCollapse(d.getAttribute('data-dir')); return; }
  const f = e.target.closest('.file'); if (!f) return;
  vscode.postMessage({ type: 'log/openFile', payload: { hash: f.getAttribute('data-hash'), path: f.getAttribute('data-path'), status: f.getAttribute('data-status'), oldPath: f.getAttribute('data-oldpath') || undefined } });
});

const DINDENT = 14;
function detailLeafHtml(hash, f, depth, label) {
  return '<div class="file" style="padding-left:' + (depth * DINDENT + 10) + 'px" data-hash="' + esc(hash) + '" data-path="' + esc(f.path) + '" data-oldpath="' + esc(f.oldPath || '') + '" data-status="' + esc(f.status) + '"><span class="dot" style="color:var(--vscode-' + f.themeColor.replace(/\\./g, '-') + ')">' + esc(f.statusLabel) + '</span><span class="nm">' + esc(label) + '</span></div>';
}
function renderDetailNode(node, depth, hash, files, out) {
  if (node.dir) {
    const isCol = dcollapsed.has(node.path);
    out.push('<div class="tree-dir" style="padding-left:' + (depth * DINDENT + 8) + 'px" data-dir="' + esc(node.path) + '"><span class="tree-twist">' + (isCol ? '\\u25B8' : '\\u25BE') + '</span><span class="tree-name">' + esc(node.name) + '</span></div>');
    if (!isCol) { for (const c of node.children) renderDetailNode(c, depth + 1, hash, files, out); }
  } else {
    out.push(detailLeafHtml(hash, files[node.fileIndex], depth, node.name));
  }
}
function pruneDetailCollapsed(tree) {
  const present = new Set();
  (function walk(nodes) { (nodes || []).forEach(function (n) { if (n.dir) { present.add(n.path); walk(n.children); } }); })(tree);
  Array.from(dcollapsed).forEach(function (p) { if (!present.has(p)) dcollapsed.delete(p); });
}
function toggleDetailCollapse(p) {
  if (dcollapsed.has(p)) dcollapsed.delete(p); else dcollapsed.add(p);
  persist();
  renderDetails(curDetailHash, curDetailFiles, curDetailTree);
}
function updateDetailModeButtons() {
  dmodeFlatEl.classList.toggle('active', detailsMode === 'flat');
  dmodeTreeEl.classList.toggle('active', detailsMode === 'tree');
  dmodeFlatEl.setAttribute('aria-pressed', String(detailsMode === 'flat'));
  dmodeTreeEl.setAttribute('aria-pressed', String(detailsMode === 'tree'));
}
function setDetailMode(m) { if (detailsMode === m) return; detailsMode = m; persist(); updateDetailModeButtons(); if (curDetailHash) renderDetails(curDetailHash, curDetailFiles, curDetailTree); }
dmodeFlatEl.addEventListener('click', function () { setDetailMode('flat'); });
dmodeTreeEl.addEventListener('click', function () { setDetailMode('tree'); });

function renderDetails(hash, files, tree) {
  if (!hash) { detailsEl.classList.remove('show'); return; }
  curDetailHash = hash; curDetailFiles = files || []; curDetailTree = tree || [];
  updateDetailModeButtons();
  detailsTitleEl.textContent = 'Changed Files (' + curDetailFiles.length + ') · ' + hash.slice(0, 7);
  if (curDetailFiles.length === 0) { detailsList.innerHTML = '<div class="file" style="opacity:.6">No changed files (may be a root or merge commit)</div>'; detailsEl.classList.add('show'); return; }
  pruneDetailCollapsed(curDetailTree);
  const out = [];
  if (detailsMode === 'tree') { for (const n of curDetailTree) renderDetailNode(n, 0, hash, curDetailFiles, out); }
  else { for (const f of curDetailFiles) out.push(detailLeafHtml(hash, f, 0, (f.oldPath ? f.oldPath + ' → ' + f.path : f.path))); }
  detailsList.innerHTML = out.join('');
  detailsEl.classList.add('show');
}

// ── 提交详情悬浮卡（cursor-anchored hover tooltip，对齐官方 Source Control Graph 的观感）──
// webview 是沙箱 iframe，浮层无法溢出到编辑器区像素（这是 VS Code 扩展的硬限制，GitLens 亦然），
// 故贴近「光标处」呈现：mousemove 跟踪光标 → 悬停稳定 400ms 后请 host 组装富数据 → 回包后渲染并
// 锚在光标处（边沿自动翻转）。鼠标移到浮层上不消失（hover bridge，方便点 Open on GitHub）。
function commitStatHtml(s) {
  const parts = ['<span class="files">' + s.files + (s.files === 1 ? ' file' : ' files') + ' changed</span>'];
  if (s.insertions > 0) parts.push('<span class="ins">' + s.insertions + (s.insertions === 1 ? ' insertion(+)' : ' insertions(+)') + '</span>');
  if (s.deletions > 0) parts.push('<span class="del">' + s.deletions + (s.deletions === 1 ? ' deletion(-)' : ' deletions(-)') + '</span>');
  return parts.join(', ');
}
// 引用胶囊分组（HEAD/Branches/Remotes/Tags）：从图行 chips 取，底色跟随该行泳道色，与行内胶囊同款。
function refsHtml(row) {
  if (!row || !row.chips || row.chips.length === 0) return '';
  const bg = laneColor(row.layout.node.colorIdx), fg = onColor(bg);
  const groups = [['head', 'HEAD'], ['localBranch', 'Branches'], ['remoteBranch', 'Remotes'], ['tag', 'Tags']];
  const secs = [];
  for (const g of groups) {
    const kind = g[0];
    const chips = row.chips.filter(function (c) { return c.kind === kind; });
    if (chips.length === 0) continue;
    const inner = chips.map(function (c) {
      return '<span class="chip ' + kind + (c.isHeadTarget ? ' head-target' : '') + '" style="background:' + bg + ';color:' + fg + '">' + chipIcon(kind) + '<span class="chip-nm">' + esc(c.name) + '</span></span>';
    }).join('');
    secs.push('<div class="ct-sec"><span class="ct-k">' + g[1] + '</span><span class="ct-v ct-refs">' + inner + '</span></div>');
  }
  return secs.length ? '<div class="ct-refs-wrap">' + secs.join('') + '</div>' : '';
}
function renderCommitTip(vm) {
  if (!vm) return;
  const tb = [];
  if (vm.authorDateRel) tb.push(esc(vm.authorDateRel));
  if (vm.authorDateAbs) tb.push('(' + esc(vm.authorDateAbs) + ')');
  const meta = [];
  if (vm.authorEmail) meta.push(esc(vm.authorEmail));
  if (tb.length) meta.push(tb.join(' '));
  const row = model.rows.find(function (r) { return r.hash === vm.hash; });
  // Committer 行：仅当提交者与作者不同（名字或时间）才展示，避免与头部作者信息冗余。
  let committerRow = '';
  if (vm.committerName && (vm.committerName !== vm.authorName || vm.committerDate !== vm.authorDate)) {
    const ctb = [];
    if (vm.committerDateRel) ctb.push(esc(vm.committerDateRel));
    if (vm.committerDateAbs) ctb.push('(' + esc(vm.committerDateAbs) + ')');
    committerRow = '<div class="ct-sec"><span class="ct-k">Committer</span><span class="ct-v">' + esc(vm.committerName) + (ctb.length ? ' <span class="ct-dim">· ' + ctb.join(' ') + '</span>' : '') + '</span></div>';
  }
  const gh = vm.githubUrl ? '<span class="ct-gh" role="link" tabindex="0" data-url="' + esc(vm.githubUrl) + '">' + ICO_GH + 'Open on GitHub</span>' : '';
  commitTipEl.innerHTML = '<div class="ct-scroll">'
    + '<div class="ct-head"><span class="ct-avatar">' + ICO_PERSON + '</span><span class="ct-who"><span class="ct-author">' + esc(vm.authorName) + '</span>' + (meta.length ? '<span class="ct-time">' + meta.join(' · ') + '</span>' : '') + '</span></div>'
    + refsHtml(row)
    + '<div class="ct-msg"><div class="ct-subj">' + esc(vm.subject) + '</div>' + (vm.body ? '<div class="ct-body">' + esc(vm.body) + '</div>' : '') + '</div>'
    + committerRow
    + '<div class="ct-stat">' + commitStatHtml(vm.stat) + '</div>'
    + '<div class="ct-foot"><span class="ct-sha">' + esc(vm.hash) + '</span>' + gh + '</div>'
    + '</div>';
}
function showCommitTipNow() {
  positionAtCursor(commitTipEl);
  commitTipEl.classList.add('show');
}
function hideCommitTip() {
  clearTimeout(ctShowT); clearTimeout(ctHideT);
  commitTipEl.classList.remove('show');
  commitTipEl.style.display = 'none';
  commitTipEl.innerHTML = '';
  ctHash = null;
}
function scheduleShowCommit(hash) {
  clearTimeout(ctHideT);
  if (ctHash === hash && commitTipEl.classList.contains('show')) return;
  clearTimeout(ctShowT);
  ctHash = hash; // 标记当前意图 hash；回包校验一致才渲染，过期响应丢弃。
  ctShowT = setTimeout(function () {
    vscode.postMessage({ type: 'log/showCommitDetail', payload: { hash: hash } });
  }, 400);
}
function scheduleHideCommit() {
  clearTimeout(ctShowT);
  clearTimeout(ctHideT);
  ctHideT = setTimeout(function () { hideCommitTip(); }, 200);
}
rowsEl.addEventListener('mouseover', function (e) {
  const ci = e.target.closest && e.target.closest('.ci');
  if (ci && !ci.classList.contains('ci-empty')) { hideCommitTip(); return; } // 进入 CI 图标区：即时隐藏提交浮层并取消在途，二者互斥。
  const r = e.target.closest && e.target.closest('.row');
  if (!r) return;
  scheduleShowCommit(r.getAttribute('data-hash'));
});
rowsEl.addEventListener('mouseout', function (e) {
  const r = e.target.closest && e.target.closest('.row');
  if (!r) return;
  const to = e.relatedTarget;
  if (to && (commitTipEl.contains(to) || r.contains(to))) return; // 行内移动或进入浮层不隐藏。
  scheduleHideCommit();
});
// hover bridge：鼠标移到浮层上时取消隐藏（方便点击 Open on GitHub），离开则隐藏。
commitTipEl.addEventListener('mouseenter', function () { clearTimeout(ctHideT); });
commitTipEl.addEventListener('mouseleave', scheduleHideCommit);
commitTipEl.addEventListener('click', function (e) {
  const t = e.target.closest('.ct-gh'); if (!t) return;
  const u = t.getAttribute('data-url');
  if (u) vscode.postMessage({ type: 'log/openExternal', payload: { url: u } });
});
commitTipEl.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' || e.key === ' ') { const t = e.target.closest('.ct-gh'); if (t) { e.preventDefault(); const u = t.getAttribute('data-url'); if (u) vscode.postMessage({ type: 'log/openExternal', payload: { url: u } }); } }
  if (e.key === 'Escape') { hideCommitTip(); }
});

window.addEventListener('message', function (e) {
  const m = e.data;
  if (m.type === 'log/graphData') {
    model = { rows: m.payload.rows, maxLanes: m.payload.maxLanes, hasMore: m.payload.hasMore, repoRoot: m.payload.repoRoot, multiRepo: !!m.payload.multiRepo };
    // 仓库名按钮：多仓库态显示 basename + ▾（Git Graph 形态），单仓库保持完整路径纯文本观感。
    scope = m.payload.scope;
    if (model.multiRepo) {
      repoEl.textContent = repoBasename(m.payload.repoRoot) + ' ▾';
      repoEl.title = m.payload.repoRoot + ' — Switch repository';
      repoEl.setAttribute('aria-label', 'Switch repository: ' + m.payload.repoRoot);
      repoEl.classList.add('switchable');
    } else {
      repoEl.textContent = m.payload.repoRoot; repoEl.title = m.payload.repoRoot;
      repoEl.removeAttribute('aria-label');
      repoEl.classList.remove('switchable');
    }
    // 保留 ciByHash 稳定缓存（CI 状态以不可变 hash 为键）：图重置只清请求去重集合，
    // 已缓存的提交重绘时立即可见图标，避免「清缓存→重拉→整行重建」的闪烁。
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
    renderDetails(m.payload.hash, m.payload.files, m.payload.tree);
  } else if (m.type === 'log/busy') {
    spinnerEl.style.display = m.payload.busy ? 'block' : 'none';
  } else if (m.type === 'log/error') {
    spinnerEl.style.display = 'none'; emptyEl.style.display = 'none';
    errorMsgEl.textContent = m.payload.message || 'Unexpected error';
    errorEl.style.display = 'block';
  } else if (m.type === 'log/ciMeta') {
    ciMeta = { available: !!m.payload.available, needsSignIn: !!m.payload.needsSignIn, error: m.payload.error || '' };
    renderCiMeta();
    if (ciMeta.available) ensurePendingRefresh(); else stopPendingRefresh();
    renderedFirst = -1; // 强制重绘可见行（CI 槽位/登录提示出现或消失）
    scheduleRender();
  } else if (m.type === 'log/ciData') {
    const map = m.payload.map;
    ciRefreshing = false;
    if (Object.keys(map).length === 0) return;
    applyCiData(map); // 就地补丁可见行图标，杜绝整行重建闪烁
    // 数据到达后重锚开启中的 Tooltip（图标新增/pending→终态变化）。
    if (tipHash && (tipHash in map) && ciTipEl.classList.contains('show')) {
      requestAnimationFrame(function () {
        const el = rowsEl.querySelector('[data-ci="' + tipHash.replace(/[^a-f0-9]/gi, '') + '"]');
        if (el) { buildTip(ciByHash[tipHash]); positionTip(); }
        else hideTip();
      });
    }
  } else if (m.type === 'log/commitDetail') {
    // 提交详情回包：仅当仍是当前意图 hash 才渲染（丢弃过期响应）；光标已知→锚光标，键盘→锚行 rect。
    const vm = m.payload.vm;
    if (!vm || vm.hash !== ctHash) return;
    renderCommitTip(vm);
    if (window.__ctKeybRect) { positionAtRect(commitTipEl, window.__ctKeybRect); window.__ctKeybRect = null; }
    else showCommitTipNow();
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
