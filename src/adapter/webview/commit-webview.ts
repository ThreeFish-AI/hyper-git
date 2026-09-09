import * as path from 'path';
import * as vscode from 'vscode';
import { getDecoration } from '../../engine/scm-mapping/status-decoration';
import { buildFileTree } from '../../engine/tree/file-tree';
import type { CommitRequest } from '../commit/commit-service';
import type { ChangelistRegistry } from '../changelist-registry';
import type { ChangeItem, GitRepositoryService } from '../git-repository-service';
import type {
	CommitFileItem,
	CommitViewState,
	HostToWebviewMessage,
	WebviewToHostMessage,
} from '../../shared/protocol';
import type { CommitService } from '../commit/commit-service';
import { getBaseStyles, ICON_CHEVRON_DOWN } from './shared-styles';
import { getNonce } from './nonce';

/**
 * Commit 提交窗口（WebviewView，自绘提交面板）。
 *
 * 承载活动 changelist 文件列表（平铺 / 目录树两态，切换上移标题栏互斥图标）+ 文件单击看 diff +
 * 单文件右键操作 + 多行 Commit Message 编辑器 + Amend/sign-off/skip-hooks 选项 +
 * Commit/Commit and Push 按钮 + Conventional Commits 实时校验 + 最近消息复用。
 * changelist 切换与管理（New/Rename/Delete）由标题栏 $(checklist) 图标 → setActiveChangelist
 * QuickPick 承载，活动列表名常驻 view.description 副标题；Select All 吸顶于文件列表容器内首行。
 * 选中态由 webview 端管理（host 不回写，避免覆盖用户操作）。
 * 注：活动栏未提交数角标已迁至隐藏的 hyperGit.changesBadge TreeView 承载（见 extension.ts）。
 */
export class CommitWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
	public static readonly viewType = 'hyperGit.commit';
	private view?: vscode.WebviewView;
	private currentMessage = '';
	/** 文件列表展示模式（List/Tree，标题栏图标切换）：host 为事实源，随 state 整态下发。 */
	private detailMode: 'flat' | 'tree' = 'flat';
	private readonly disposables: vscode.Disposable[] = [];

	/** List/Tree 偏好按仓库持久化 key（issue #107 同 log.dmode 范式；第三视图复用时提炼共享 helper）。 */
	private static dmodeKey(root: string): string {
		return `hyperGit.commit.dmode:${root}`;
	}
	/** context key 同步（标题栏互斥按钮显隐由 when 子句驱动）。 */
	private static setCtx(key: string, value: string | boolean): void {
		void vscode.commands.executeCommand('setContext', key, value);
	}

	constructor(
		private readonly service: GitRepositoryService,
		private readonly registry: ChangelistRegistry,
		private readonly commit: CommitService,
		private readonly workspaceState: vscode.Memento,
	) {
		// 激活即恢复当前仓库的 List/Tree 记忆并同步 context key（标题栏控件先于视图解析渲染）；
		// 活跃仓库切换（issue #107）：恢复该仓库的记忆值（无记忆回退 'flat'），
		// 文件列表刷新由 extension 的 onDidChange → refreshAll 驱动。
		this.loadRepoScopedPrefs();
		this.disposables.push(
			service.onDidChangeRepository(() => {
				this.loadRepoScopedPrefs();
			}),
		);
	}

	dispose(): void {
		for (const d of this.disposables) {
			d.dispose();
		}
		this.disposables.length = 0;
	}

	/** 装载当前仓库的 List/Tree 偏好（memento → 内存 + context key）。 */
	private loadRepoScopedPrefs(): void {
		const root = this.service.repoRoot;
		this.detailMode =
			(root ? this.workspaceState.get<'flat' | 'tree'>(CommitWebviewProvider.dmodeKey(root)) : undefined) ?? 'flat';
		CommitWebviewProvider.setCtx('hyperGit.commit.tree', this.detailMode === 'tree');
	}

	/** 标题栏 List/Tree 互斥图标切换（同 Graph/Branches 范式）：pushState 全同步且幂等，整态重发即达。 */
	setDetailMode(mode: 'flat' | 'tree'): void {
		if (this.detailMode === mode) {
			return;
		}
		const root = this.service.repoRoot;
		if (root) {
			void this.workspaceState.update(CommitWebviewProvider.dmodeKey(root), mode);
		}
		this.detailMode = mode;
		CommitWebviewProvider.setCtx('hyperGit.commit.tree', mode === 'tree');
		this.pushState();
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = { enableScripts: true, localResourceRoots: [] };
		view.webview.html = this.renderHtml();
		const msgSub = view.webview.onDidReceiveMessage((msg) => this.onMessage(msg as WebviewToHostMessage));
		view.onDidDispose(() => {
			msgSub.dispose();
			this.view = undefined;
		});
		this.pushState();
	}

	refresh(): void {
		this.pushState();
	}

	private onMessage(msg: WebviewToHostMessage): void {
		switch (msg.type) {
			case 'requestState':
				this.pushState();
				break;
			case 'messageChanged':
				this.currentMessage = msg.payload.message;
				this.sendValidation();
				break;
			case 'commit':
				void this.handleCommit(msg.payload);
				break;
			case 'commit/openFile': {
				const change = this.findChange(msg.payload.path);
				if (change) {
					void vscode.commands.executeCommand('hyperGit.openDiff', change);
				}
				break;
			}
			case 'commit/fileMenu':
				void this.handleFileMenu(msg.payload.path);
				break;
		}
	}

	private findChange(relativePath: string): ChangeItem | undefined {
		return this.service.getChanges().find((c) => c.relativePath === relativePath);
	}

	/** 单文件右键：原生 QuickPick 承载原 Changes 树文件菜单的全部操作，复用既有命令（含 discard 确认框）。 */
	private async handleFileMenu(relativePath: string): Promise<void> {
		const change = this.findChange(relativePath);
		if (!change) {
			return;
		}
		// QuickPick label 支持 $(codicon) 内联图标（与 changelist 标题栏 QuickPick 对齐）。
		const actions: ReadonlyArray<{ readonly label: string; readonly command: string }> = [
			{ label: '$(diff) Open Diff', command: 'hyperGit.openDiff' },
			{ label: '$(symbol-enum) Move to Changelist…', command: 'hyperGit.moveChangelist' },
			{ label: '$(history) Show History', command: 'hyperGit.showHistory' },
			{ label: '$(diff-added) Stage Hunks…', command: 'hyperGit.partialStage' },
			{ label: '$(diff-removed) Unstage Hunks…', command: 'hyperGit.partialUnstage' },
			{ label: '$(diff-ignored) Add to .gitignore', command: 'hyperGit.ignorePath' },
			{ label: '$(discard) Discard Changes', command: 'hyperGit.discardChanges' },
		];
		const pick = await vscode.window.showQuickPick(actions.slice(), { placeHolder: relativePath });
		if (!pick) {
			return;
		}
		await vscode.commands.executeCommand(pick.command, change);
	}

	private sendValidation(): void {
		this.post({ type: 'conventionalValidation', payload: this.commit.validateMessage(this.currentMessage) });
	}

	private async handleCommit(payload: CommitRequest): Promise<void> {
		const result = await this.commit.executeCommit(payload);
		this.post({ type: 'commitResult', payload: result });
		if (result.ok) {
			this.currentMessage = '';
			this.pushState();
		}
	}

	private post(message: HostToWebviewMessage): void {
		this.view?.webview.postMessage(message);
	}

	private toFileItem(c: ChangeItem): CommitFileItem {
		const decoration = getDecoration(c.status);
		return {
			path: c.relativePath,
			label: path.basename(c.relativePath),
			dir: path.dirname(c.relativePath),
			themeColor: decoration.themeColor,
			letter: decoration.letter,
		};
	}

	private pushState(): void {
		if (!this.view) {
			return;
		}
		const changes = this.service.getChanges();
		const groups = this.registry.getGroups(changes, (c) => c.relativePath);
		const activeId = this.registry.activeChangelistId;
		const activeGroup = groups.find((g) => g.id === activeId) ?? groups.find((g) => g.active) ?? groups[0];
		const files = (activeGroup?.items ?? []).map((c) => this.toFileItem(c));
		const state: CommitViewState = {
			template: this.commit.getTemplate(),
			recentMessages: this.commit.getRecentMessages(),
			mode: this.detailMode,
			files,
			tree: buildFileTree(files.map((f) => f.path)),
			conventionalEnabled: this.commit.conventionalEnabled(),
			busy: false,
			repoRoot: this.service.repoRoot ?? '',
		};
		// 标题栏副标题 = 活动 changelist 名（原 webview 头部切换行上移，省一行竖直空间）。
		this.view.description = this.registry.getDef(activeId)?.name ?? 'Default';
		this.post({ type: 'state', payload: state });
		this.sendValidation();
	}

	private renderHtml(): string {
		const nonce = getNonce();
		const csp = [
			'default-src \'none\'',
			'style-src \'unsafe-inline\'',
			`script-src 'nonce-${nonce}'`,
		].join('; ');

		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
${getBaseStyles()}
body { margin: 0; padding: var(--hg-space-2); font-family: var(--vscode-font-family); color: var(--vscode-foreground); font-size: var(--vscode-font-size); background: var(--vscode-sideBar-background); }
/* Select All 吸顶行（List/Tree 切换上移标题栏后由 files-header 行迁入列表容器）：背景必须不透明（防行内容透出）。 */
.files-selectall { position: sticky; top: 0; z-index: 1; background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.3)); padding: 1px 6px; }
.file, .tree-dir { scroll-margin-top: 22px; } /* 键盘导航 scrollIntoView 补偿：防止首行被吸顶行遮挡 */
.files { max-height: 260px; overflow-y: auto; border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.3)); border-radius: var(--hg-radius-control); margin-bottom: var(--hg-space-2); }
.files:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.file.kb-focus, .tree-dir.kb-focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.file { display: flex; align-items: center; gap: 6px; padding: 2px 6px; cursor: pointer; }
.file:hover { background: var(--vscode-list-hoverBackground); }
.file .dot { flex: 0 0 1.2em; text-align: center; font-weight: 600; font-size: calc(var(--vscode-font-size) - 1px); line-height: 1; }
.file .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file .dir { margin-left: auto; color: var(--vscode-descriptionForeground); font-size: calc(var(--vscode-font-size) - 2px); white-space: nowrap; padding-left: 8px; }
.tree-dir { display: flex; align-items: center; gap: 6px; padding: 2px 6px; cursor: pointer; user-select: none; }
.tree-dir:hover { background: var(--vscode-list-hoverBackground); }
.tree-twist { flex: 0 0 14px; display: inline-flex; align-items: center; justify-content: center; opacity: 0.8; }
.tree-twist svg { display: block; }
.tree-twist.collapsed svg { transform: rotate(-90deg); }
.tree-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--vscode-descriptionForeground); }
textarea { width: 100%; box-sizing: border-box; resize: vertical; }
.validation { font-size: calc(var(--vscode-font-size) - 2px); min-height: 16px; margin: 4px 2px; }
.validation.ok { color: var(--vscode-testing-iconPassed, #3fb950); }
.validation.warning { color: var(--vscode-editorWarning-foreground, #d29922); }
.validation.error { color: var(--vscode-errorForeground, #f85149); }
.recent { margin: 4px 0 var(--hg-space-2); display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.recent-label { color: var(--vscode-descriptionForeground); font-size: calc(var(--vscode-font-size) - 2px); }
.hg-chip { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 9px; padding: 1px 8px; font-size: calc(var(--vscode-font-size) - 2px); cursor: pointer; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hg-chip:hover { opacity: 0.85; }
.hg-chip:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
.opt { display: block; font-size: calc(var(--vscode-font-size) - 1px); margin: 3px 2px; }
.buttons { display: flex; gap: 6px; margin-top: var(--hg-space-2); }
.buttons .hg-btn { flex: 1; }
.files-empty { padding: 14px 8px; text-align: center; color: var(--vscode-descriptionForeground); font-size: calc(var(--vscode-font-size) - 1px); }
.spinner { display: inline-block; width: 12px; height: 12px; border: 1.5px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: hg-spin 0.8s linear infinite; vertical-align: -2px; margin-right: 5px; }
@keyframes hg-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
	.spinner { animation-duration: 1.6s; } /* 前庭安全：降频保留进行中指示（与 Graph .ci-spin 同策略） */
}
details.advanced { margin: 6px 0 var(--hg-space-2); }
details.advanced summary { cursor: pointer; font-size: calc(var(--vscode-font-size) - 1px); color: var(--vscode-descriptionForeground); }
details.advanced summary:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; border-radius: 2px; }
details.advanced[open] summary { margin-bottom: 4px; }
.toast { font-size: calc(var(--vscode-font-size) - 1px); margin-top: var(--hg-space-2); min-height: 16px; }
.toast.ok { color: var(--vscode-testing-iconPassed, #3fb950); }
.toast.err { color: var(--vscode-errorForeground, #f85149); }
</style>
</head>
<body>
<div class="files" id="files" tabindex="0">
  <div class="files-selectall" id="files-selectall" style="display:none">
    <label class="opt" style="margin:0"><input type="checkbox" id="select-all"> Select All</label>
  </div>
  <div id="files-rows" role="tree" aria-label="Changed files"></div>
</div>
<textarea id="message" class="hg-input" rows="4" placeholder="Commit message (Conventional Commits: type(scope): description)" spellcheck="false"></textarea>
<div id="validation" class="validation" role="status" aria-live="polite"></div>
<div class="recent" id="recent"></div>
<details class="advanced">
  <summary>Advanced Options</summary>
  <label class="opt"><input type="checkbox" id="amend"> Amend Last Commit</label>
  <label class="opt"><input type="checkbox" id="signoff"> Append Signed-off-by</label>
  <label class="opt"><input type="checkbox" id="skipHooks"> Skip Git Hooks (--no-verify)</label>
</details>
<div class="buttons">
<button id="commit-btn" class="hg-btn">Commit</button>
<button id="commit-push-btn" class="hg-btn hg-btn--secondary">Commit &amp; Push</button>
</div>
<div id="toast" class="toast" role="status" aria-live="polite"></div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
// ── 勾选集/折叠集/提交草稿按仓库分区（v3，issue #107）：勾选是相对路径集合，跨仓库本就错位；
// 切换仓库换装载互不串扰；v3 起 draft（message + amend/signoff/skipHooks）一并入 state——
// 视图隐藏销毁 / 窗口 reload 后草稿可恢复（对齐内置 SCM 输入框草稿语义），提交成功即清空。
// 旧版 state（v2 byRepo / v1 平铺）无感升级，draft 缺省为空；
// mode 自标题栏迁移（host workspaceState 持久化）后废弃，webview 不再读写。──
const persistedRaw = vscode.getState() || {};
let persistedRepo = '';
let persistedByRepo = {};
if ((persistedRaw.v === 2 || persistedRaw.v === 3) && persistedRaw.byRepo) {
  persistedByRepo = persistedRaw.byRepo;
} else if (persistedRaw.checked || persistedRaw.collapsed) {
  persistedByRepo = { '': { checked: persistedRaw.checked, collapsed: persistedRaw.collapsed } };
}
let checked = new Set();
let mode = 'flat'; // 渲染模式：host 经 state 下发（标题栏 List/Tree 图标切换），webview 不再持久化
let collapsed = new Set();
let draft = null; // 当前仓库的草稿快照（loadPersistedFor 装载；仅 webview 重建/切仓库时回灌 DOM）
let stateV3Written = false; // 本会话是否已落盘 v3 state：true 后 '' 兜底关闭（见 loadPersistedFor）
function loadPersistedFor(repoRoot) {
  persistedRepo = repoRoot;
  // '' 条目兜底仅用于旧版 state（v1 平铺 / v2 迁移语义）；v3 起按仓严格隔离——
  // 无本仓条目即空对象，避免无仓库会话期（repoRoot=''）写入的草稿回灌到其他仓库。
  // persistedRaw.v 是启动快照、saveState 后不更新：stateV3Written 补位——本会话首写 v3 后
  // 即关闭兜底，升级/全新会话内同样保持隔离，无需等下一次 webview 重建。
  const fallback = persistedRaw.v === 3 || stateV3Written ? undefined : persistedByRepo[''];
  const s = persistedByRepo[repoRoot] || fallback || {};
  checked = new Set(s.checked || []);
  collapsed = new Set(s.collapsed || []);
  draft = s.draft || null;
}
// saveState 从 DOM 现值取 draft（草稿写点统一收敛于此）：输入即时保存，彻底消除 200ms debounce 尾丢。
function saveState() {
  persistedByRepo[persistedRepo] = {
    checked: Array.from(checked),
    collapsed: Array.from(collapsed),
    draft: { message: msgEl.value, amend: amendEl.checked, signoff: signoffEl.checked, skipHooks: skipHooksEl.checked }
  };
  vscode.setState({ v: 3, byRepo: persistedByRepo });
  stateV3Written = true;
}
let draftRestored = false;
let conventionalEnabled = true;
let templateApplied = false;
let curFiles = [];
let curTree = [];
const INDENT = 14;
const ICON_CHEVRON = ${JSON.stringify(ICON_CHEVRON_DOWN)};
const EMPTY_HTML = '<div class="files-empty">No changes in this changelist.<br>Edit files in your workspace and they will appear here.</div>';
const filesEl = document.getElementById('files');
const msgEl = document.getElementById('message');
const valEl = document.getElementById('validation');
const recentEl = document.getElementById('recent');
const commitBtn = document.getElementById('commit-btn');
const commitPushBtn = document.getElementById('commit-push-btn');
const amendEl = document.getElementById('amend');
const signoffEl = document.getElementById('signoff');
const skipHooksEl = document.getElementById('skipHooks');
const toastEl = document.getElementById('toast');
const selectAllEl = document.getElementById('select-all');
const filesSelectAllEl = document.getElementById('files-selectall');
const filesRowsEl = document.getElementById('files-rows');

let msgTimer = null;
msgEl.addEventListener('input', function () {
  saveState(); // 草稿即时持久化（防抖前落盘，视图销毁不丢尾部输入）
  clearTimeout(msgTimer);
  msgTimer = setTimeout(function () {
    vscode.postMessage({ type: 'messageChanged', payload: { message: msgEl.value } });
  }, 200);
});
amendEl.addEventListener('change', saveState);
signoffEl.addEventListener('change', saveState);
skipHooksEl.addEventListener('change', saveState);

// Ctrl/Cmd+Enter 提交（业界通用快捷键：VS Code/GitHub/JetBrains 一致）。
msgEl.addEventListener('keydown', function (e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    doCommit(false);
  }
});

function setBusy(b) {
  commitBtn.disabled = b; commitPushBtn.disabled = b;
  commitBtn.innerHTML = b ? '<span class="spinner" aria-hidden="true"></span>Committing…' : 'Commit';
}

function doCommit(push) {
  setBusy(true);
  vscode.postMessage({
    type: 'commit',
    payload: {
      message: msgEl.value,
      selectedPaths: Array.from(checked),
      amend: amendEl.checked,
      signoff: signoffEl.checked,
      skipHooks: skipHooksEl.checked,
      push: push
    }
  });
}
commitBtn.addEventListener('click', function () { doCommit(false); });
commitPushBtn.addEventListener('click', function () { doCommit(true); });

// ── 选中态调和：一次 state 推送做一次（新文件默认勾选、清理不存在项），mode 切换重渲不重复调和 ──
function reconcileChecked(files) {
  const present = new Set();
  files.forEach(function (f) { present.add(f.path); if (!checked.has(f.path)) checked.add(f.path); });
  Array.from(checked).forEach(function (p) { if (!present.has(p)) checked.delete(p); });
  saveState();
}

function pruneCollapsed(tree) {
  const present = new Set();
  (function walk(nodes) { (nodes || []).forEach(function (n) { if (n.dir) { present.add(n.path); walk(n.children); } }); })(tree);
  Array.from(collapsed).forEach(function (p) { if (!present.has(p)) collapsed.delete(p); });
}

function syncSelectAll() {
  const total = curFiles.length;
  selectAllEl.checked = total > 0 && curFiles.every(function (f) { return checked.has(f.path); });
}

// ── 单条文件行（平铺与树形共用；depth 控制缩进，flat 追加右侧目录列）──
function makeLeafRow(f, depth) {
  const row = document.createElement('div');
  row.className = 'file';
  row.style.paddingLeft = (depth * INDENT + 6) + 'px';
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.className = 'file-cb'; cb.dataset.path = f.path;
  cb.checked = checked.has(f.path);
  cb.addEventListener('change', function () {
    if (cb.checked) checked.add(f.path); else checked.delete(f.path);
    saveState(); syncSelectAll(); updateDirStates();
  });
  // 状态字母标记（M/A/U/R/D/C…）替代色点：色盲可辨、对齐官方 SCM 角标（兜底空串）。
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.color = 'var(--vscode-' + f.themeColor.replace(/\\./g, '-') + ')';
  dot.textContent = f.letter || '';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = f.label;
  name.title = f.path;
  row.appendChild(cb); row.appendChild(dot); row.appendChild(name);
  if (mode === 'flat') {
    const dir = document.createElement('span');
    dir.className = 'dir';
    dir.textContent = f.dir && f.dir !== '.' ? f.dir : '';
    row.appendChild(dir);
  }
  row.addEventListener('click', function (e) {
    if (e.target.closest('.file-cb')) return; // 勾选框自行处理，不触发 diff
    vscode.postMessage({ type: 'commit/openFile', payload: { path: f.path } });
  });
  row.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    vscode.postMessage({ type: 'commit/fileMenu', payload: { path: f.path } });
  });
  return row;
}

function renderFlat(files) {
  const frag = document.createDocumentFragment();
  files.forEach(function (f) { frag.appendChild(makeLeafRow(f, 0)); });
  filesRowsEl.appendChild(frag);
}

function renderTree(tree, files) {
  const frag = document.createDocumentFragment();
  tree.forEach(function (n) { renderNode(n, 0, frag, files); });
  filesRowsEl.appendChild(frag);
  updateDirStates();
}

function renderNode(node, depth, parent, files) {
  if (node.dir) {
    const isCol = collapsed.has(node.path);
    const dirRow = document.createElement('div');
    dirRow.className = 'tree-dir';
    dirRow.style.paddingLeft = (depth * INDENT + 6) + 'px';
    dirRow.dataset.dir = node.path;
    const tw = document.createElement('span');
    tw.className = 'tree-twist' + (isCol ? ' collapsed' : '');
    tw.innerHTML = ICON_CHEVRON;
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 'dir-cb'; cb.dataset.dir = node.path;
    cb.addEventListener('click', function (e) { e.stopPropagation(); });
    cb.addEventListener('change', function () { setSubtreeChecked(node, cb.checked); saveState(); syncSelectAll(); });
    const nm = document.createElement('span');
    nm.className = 'tree-name';
    nm.textContent = node.name;
    dirRow.appendChild(tw); dirRow.appendChild(cb); dirRow.appendChild(nm);
    dirRow.addEventListener('click', function () { toggleCollapse(node.path); });
    parent.appendChild(dirRow);
    if (!isCol) { node.children.forEach(function (c) { renderNode(c, depth + 1, parent, files); }); }
  } else {
    parent.appendChild(makeLeafRow(files[node.fileIndex], depth));
  }
}

function subtreeLeafPaths(node) {
  const acc = [];
  (function collect(n) { if (!n.dir) { acc.push(curFiles[n.fileIndex].path); } else n.children.forEach(collect); })(node);
  return acc;
}

function setSubtreeChecked(node, want) {
  const paths = subtreeLeafPaths(node);
  paths.forEach(function (p) { if (want) checked.add(p); else checked.delete(p); });
  filesEl.querySelectorAll('.file-cb').forEach(function (cb) { if (paths.indexOf(cb.dataset.path) >= 0) cb.checked = want; });
  updateDirStates();
}

// 依据后代叶子勾选态回填目录复选框三态（全选/未选/部分选）。
function updateDirStates() {
  const dirCbs = filesEl.querySelectorAll('.dir-cb');
  if (dirCbs.length === 0) return;
  const stat = {};
  function walk(node) {
    if (!node.dir) { return { total: 1, on: checked.has(curFiles[node.fileIndex].path) ? 1 : 0 }; }
    let total = 0, on = 0;
    node.children.forEach(function (c) { const r = walk(c); total += r.total; on += r.on; });
    stat[node.path] = { total: total, on: on };
    return { total: total, on: on };
  }
  curTree.forEach(walk);
  dirCbs.forEach(function (cb) {
    const s = stat[cb.dataset.dir];
    if (!s) return;
    cb.checked = s.total > 0 && s.on === s.total;
    cb.indeterminate = s.on > 0 && s.on < s.total;
  });
}

function toggleCollapse(p) {
  if (collapsed.has(p)) collapsed.delete(p); else collapsed.add(p);
  saveState();
  renderList();
}

function renderList() {
  kbIdx = -1;
  filesRowsEl.innerHTML = '';
  if (!curFiles || curFiles.length === 0) {
    filesSelectAllEl.style.display = 'none';
    filesRowsEl.innerHTML = EMPTY_HTML;
    return;
  }
  filesSelectAllEl.style.display = '';
  if (mode === 'tree') { renderTree(curTree, curFiles); } else { renderFlat(curFiles); }
  syncSelectAll();
}

// ── 键盘可达性（复刻 Graph #viewport 模式）：容器级焦点，ArrowUp/Down/Home/End 移动、Enter 触发行、Escape 归还 ──
let kbIdx = -1;
function kbRows() { return Array.from(filesEl.querySelectorAll('.file, .tree-dir')); }
function kbApply(idx) {
  const rows = kbRows();
  kbRows().forEach(function (r) { r.classList.remove('kb-focus'); });
  kbIdx = idx;
  if (kbIdx >= 0 && kbIdx < rows.length) {
    rows[kbIdx].classList.add('kb-focus');
    rows[kbIdx].scrollIntoView({ block: 'nearest' });
  }
}
filesEl.addEventListener('keydown', function (e) {
  const rows = kbRows();
  if (rows.length === 0) { return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (kbIdx < 0) { kbApply(e.key === 'ArrowDown' ? 0 : rows.length - 1); return; }
    kbApply(Math.max(0, Math.min(rows.length - 1, kbIdx + (e.key === 'ArrowDown' ? 1 : -1))));
  } else if (e.key === 'Home') {
    e.preventDefault(); kbApply(0);
  } else if (e.key === 'End') {
    e.preventDefault(); kbApply(rows.length - 1);
  } else if (e.key === 'Enter' && kbIdx >= 0) {
    e.preventDefault();
    rows[kbIdx].click();
  } else if (e.key === 'Escape') {
    kbApply(-1);
    filesEl.blur();
  }
});
filesEl.addEventListener('focus', function () { if (kbIdx < 0) { kbApply(0); } });

selectAllEl.addEventListener('change', function () {
  const want = selectAllEl.checked;
  curFiles.forEach(function (f) { if (want) checked.add(f.path); else checked.delete(f.path); });
  filesEl.querySelectorAll('.file-cb').forEach(function (cb) { cb.checked = want; });
  saveState(); updateDirStates();
});

function renderRecent(messages) {
  recentEl.innerHTML = '';
  if (!messages || !messages.length) return;
  const label = document.createElement('span');
  label.className = 'recent-label';
  label.textContent = 'Recent: ';
  recentEl.appendChild(label);
  messages.slice(0, 5).forEach(function (m) {
    const chip = document.createElement('button');
    chip.className = 'hg-chip';
    chip.textContent = m.split('\\n')[0].slice(0, 40);
    chip.title = m;
    chip.addEventListener('click', function () {
      msgEl.value = m;
      saveState();
      vscode.postMessage({ type: 'messageChanged', payload: { message: msgEl.value } });
    });
    recentEl.appendChild(chip);
  });
}

function showValidation(v) {
  valEl.className = 'validation ' + v.severity;
  valEl.textContent = '';
  // 图标字符单独 aria-hidden（不进读屏播报）；\\uFE0E 强制文本呈现（防 ⚠/ℹ 在部分平台渲染为彩色 emoji）。
  function iconSpan(ch) {
    const el = document.createElement('span');
    el.setAttribute('aria-hidden', 'true');
    el.textContent = ch + '\\uFE0E';
    el.style.marginRight = '4px';
    return el;
  }
  if (v.severity === 'ok') {
    if (conventionalEnabled) { valEl.appendChild(iconSpan('\\u2713')); valEl.appendChild(document.createTextNode('Valid Conventional Commits')); }
  } else {
    valEl.appendChild(iconSpan(v.severity === 'error' ? '\\u26A0' : '\\u2139'));
    valEl.appendChild(document.createTextNode(v.reason || ''));
  }
}

function toast(msg, isErr) {
  toastEl.textContent = msg;
  toastEl.className = 'toast ' + (isErr ? 'err' : 'ok');
  setTimeout(function () { toastEl.className = 'toast'; }, 3500);
}

window.addEventListener('message', function (e) {
  const m = e.data;
  if (m.type === 'state') {
    const p = m.payload;
    const repoRoot = p.repoRoot || '';
    // 草稿回灌仅两种时机：webview 重建后首帧、活跃仓库切换（loadPersistedFor 会改写 persistedRepo，先判定）。
    // 必须先于 reconcileChecked/saveState——saveState 从 DOM 取草稿，先回灌才能在后续保存中保住草稿。
    // 回灌必须无条件同步 DOM（目标仓库无草稿则清空）：否则旧仓库的 message/amend 残留 DOM，
    // 随后被 saveState 落盘为新仓库草稿（跨仓串扰；amend=true 泄漏会静默改写新仓库 HEAD）。
    const restoreDraft = !draftRestored || repoRoot !== persistedRepo;
    loadPersistedFor(repoRoot);
    if (restoreDraft) {
      msgEl.value = (draft && draft.message) || '';
      amendEl.checked = Boolean(draft && draft.amend);
      signoffEl.checked = Boolean(draft && draft.signoff);
      skipHooksEl.checked = Boolean(draft && draft.skipHooks);
      vscode.postMessage({ type: 'messageChanged', payload: { message: msgEl.value } });
    }
    draftRestored = true;
    curFiles = p.files || [];
    curTree = p.tree || [];
    mode = p.mode === 'tree' ? 'tree' : 'flat';
    reconcileChecked(curFiles);
    pruneCollapsed(curTree);
    renderList();
    renderRecent(p.recentMessages);
    conventionalEnabled = p.conventionalEnabled;
    if (!templateApplied && p.template && !msgEl.value) {
      msgEl.value = p.template;
      saveState();
      vscode.postMessage({ type: 'messageChanged', payload: { message: msgEl.value } });
    }
    templateApplied = true;
  } else if (m.type === 'conventionalValidation') {
    showValidation(m.payload);
  } else if (m.type === 'commitResult') {
    setBusy(false);
    if (m.payload.ok) {
      toast(m.payload.warning || 'Commit succeeded', Boolean(m.payload.warning));
      msgEl.value = '';
      amendEl.checked = false; signoffEl.checked = false; skipHooksEl.checked = false;
      saveState(); // 提交成功清空草稿（失败保留，供修改重试）
      vscode.postMessage({ type: 'messageChanged', payload: { message: '' } });
    } else {
      toast(m.payload.error || 'Commit failed', true);
    }
  }
});

vscode.postMessage({ type: 'requestState' });
</script>
</body>
</html>`;
	}
}
