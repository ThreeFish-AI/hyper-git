import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { getDecoration } from '../../engine/scm-mapping/status-decoration';
import { buildFileTree } from '../../engine/tree/file-tree';
import type { CommitRequest } from '../commit/commit-service';
import type { ChangelistRegistry } from '../changelist-registry';
import type { ChangeItem, GitRepositoryService } from '../git-repository-service';
import type {
	CommitChangelistItem,
	CommitFileItem,
	CommitViewState,
	HostToWebviewMessage,
	WebviewToHostMessage,
} from '../../shared/protocol';
import type { CommitService } from '../commit/commit-service';
import { getBaseStyles } from './shared-styles';

/**
 * Commit 提交窗口（WebviewView，自绘提交面板）。
 *
 * 承载活动 changelist 文件列表（平铺 / 目录树两态可切）+ 文件单击看 diff + 单文件右键操作 +
 * changelist 切换与管理（由原 Changes 视图平移而来）+ 多行 Commit Message 编辑器 +
 * Amend/sign-off/skip-hooks 选项 + Commit/Commit and Push 按钮 + Conventional Commits 实时校验 +
 * 最近消息复用。选中态由 webview 端管理（host 不回写，避免覆盖用户操作）。
 * 注：活动栏未提交数角标已迁至隐藏的 hyperGit.changesBadge TreeView 承载（见 extension.ts）。
 */
export class CommitWebviewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'hyperGit.commit';
	private view?: vscode.WebviewView;
	private currentMessage = '';

	constructor(
		private readonly service: GitRepositoryService,
		private readonly registry: ChangelistRegistry,
		private readonly commit: CommitService,
	) {}

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
			case 'commit/setActive':
				void vscode.commands.executeCommand('hyperGit.setActiveChangelist', msg.payload.id);
				break;
			case 'commit/changelistMenu':
				void this.handleChangelistMenu(msg.payload.id);
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
		const actions: ReadonlyArray<{ readonly label: string; readonly command: string }> = [
			{ label: 'Open Diff', command: 'hyperGit.openDiff' },
			{ label: 'Move to Changelist…', command: 'hyperGit.moveChangelist' },
			{ label: 'Show History', command: 'hyperGit.showHistory' },
			{ label: 'Stage Hunks…', command: 'hyperGit.partialStage' },
			{ label: 'Unstage Hunks…', command: 'hyperGit.partialUnstage' },
			{ label: 'Add to .gitignore', command: 'hyperGit.ignorePath' },
			{ label: 'Discard Changes', command: 'hyperGit.discardChanges' },
		];
		const pick = await vscode.window.showQuickPick(actions.slice(), { placeHolder: relativePath });
		if (!pick) {
			return;
		}
		await vscode.commands.executeCommand(pick.command, change);
	}

	/** changelist 头部 ⋯ 菜单：新建 / 重命名 / 删除（默认列表不可改名删除，复用既有命令）。 */
	private async handleChangelistMenu(id: string): Promise<void> {
		const def = this.registry.getDef(id);
		const canModify = Boolean(def) && id !== 'default';
		const items: Array<{ label: string; op: 'new' | 'rename' | 'delete' }> = [
			{ label: '$(add) New Changelist…', op: 'new' },
		];
		if (canModify && def) {
			items.push({ label: `$(edit) Rename "${def.name}"…`, op: 'rename' });
			items.push({ label: `$(trash) Delete "${def.name}"…`, op: 'delete' });
		}
		const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Changelist actions' });
		if (!pick) {
			return;
		}
		if (pick.op === 'new') {
			await vscode.commands.executeCommand('hyperGit.newChangelist');
		} else if (pick.op === 'rename') {
			await vscode.commands.executeCommand('hyperGit.renameChangelist', id);
		} else {
			await vscode.commands.executeCommand('hyperGit.deleteChangelist', id);
		}
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
		};
	}

	private pushState(): void {
		if (!this.view) {
			return;
		}
		const changes = this.service.getChanges();
		const groups = this.registry.getGroups(changes, (c) => c.relativePath);
		const activeId = this.registry.activeChangelistId;
		const changelists: CommitChangelistItem[] = groups.map((g) => ({ id: g.id, name: g.name, count: g.items.length }));
		const activeGroup = groups.find((g) => g.id === activeId) ?? groups.find((g) => g.active) ?? groups[0];
		const files = (activeGroup?.items ?? []).map((c) => this.toFileItem(c));
		const state: CommitViewState = {
			template: this.commit.getTemplate(),
			recentMessages: this.commit.getRecentMessages(),
			activeChangelistName: this.registry.getDef(activeId)?.name ?? 'Default',
			activeChangelistId: activeId,
			changelists,
			files,
			tree: buildFileTree(files.map((f) => f.path)),
			conventionalEnabled: this.commit.conventionalEnabled(),
			busy: false,
			repoRoot: this.service.repoRoot ?? '',
		};
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
body { margin: 0; padding: var(--hg-space-2); font-family: var(--vscode-font-family); color: var(--vscode-foreground); font-size: var(--vscode-font-size); }
.cl-bar { display: flex; align-items: center; gap: 6px; margin-bottom: var(--hg-space-1); }
.cl-bar .cl-label { flex: 0 0 auto; font-weight: 600; }
#cl-switch { flex: 1 1 auto; min-width: 0; background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, transparent)); border-radius: var(--hg-radius-control); padding: 2px 4px; font-size: 12px; }
.cl-menu-btn { flex: 0 0 auto; padding: 1px 7px; }
.seg { display: inline-flex; border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; overflow: hidden; }
.seg button { background: transparent; color: var(--vscode-foreground); border: none; padding: 2px 8px; font-size: 11px; cursor: pointer; opacity: 0.7; }
.seg button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); opacity: 1; }
.files { max-height: 260px; overflow-y: auto; border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.3)); border-radius: var(--hg-radius-control); margin-bottom: var(--hg-space-2); }
.file { display: flex; align-items: center; gap: 6px; padding: 2px 6px; cursor: pointer; }
.file:hover { background: var(--vscode-list-hoverBackground); }
.file .dot { font-size: 14px; line-height: 1; flex: 0 0 auto; }
.file .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file .dir { margin-left: auto; color: var(--vscode-descriptionForeground); font-size: 11px; white-space: nowrap; padding-left: 8px; }
.tree-dir { display: flex; align-items: center; gap: 6px; padding: 2px 6px; cursor: pointer; user-select: none; }
.tree-dir:hover { background: var(--vscode-list-hoverBackground); }
.tree-twist { flex: 0 0 12px; text-align: center; font-size: 10px; opacity: 0.8; }
.tree-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--vscode-descriptionForeground); }
textarea { width: 100%; box-sizing: border-box; resize: vertical; }
.validation { font-size: 11px; min-height: 16px; margin: 4px 2px; }
.validation.ok { color: var(--vscode-testing-iconPassed, #3fb950); }
.validation.warning { color: var(--vscode-editorWarning-foreground, #d29922); }
.validation.error { color: var(--vscode-errorForeground, #f85149); }
.recent { margin: 4px 0 var(--hg-space-2); display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.recent-label { color: var(--vscode-descriptionForeground); font-size: 11px; }
.chip { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 9px; padding: 1px 8px; font-size: 11px; cursor: pointer; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip:hover { opacity: 0.85; }
.opt { display: block; font-size: 12px; margin: 3px 2px; }
.buttons { display: flex; gap: 6px; margin-top: var(--hg-space-2); }
.buttons .hg-btn { flex: 1; }
.files-header { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-height: 18px; padding: 0 6px; color: var(--vscode-descriptionForeground); }
.files-empty { padding: 14px 8px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 12px; }
.spinner { display: inline-block; width: 12px; height: 12px; border: 1.5px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: hg-spin 0.8s linear infinite; vertical-align: -2px; margin-right: 5px; }
@keyframes hg-spin { to { transform: rotate(360deg); } }
details.advanced { margin: 6px 0 var(--hg-space-2); }
details.advanced summary { cursor: pointer; font-size: 12px; color: var(--vscode-descriptionForeground); }
details.advanced summary:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; border-radius: 2px; }
details.advanced[open] summary { margin-bottom: 4px; }
.toast { font-size: 12px; margin-top: var(--hg-space-2); min-height: 16px; }
.toast.ok { color: var(--vscode-testing-iconPassed, #3fb950); }
.toast.err { color: var(--vscode-errorForeground, #f85149); }
</style>
</head>
<body>
<div class="cl-bar">
  <span class="cl-label">Active Changelist:</span>
  <select id="cl-switch" title="Switch active changelist"></select>
  <button id="cl-menu" class="hg-btn hg-btn--secondary hg-btn--sm cl-menu-btn" title="Changelist actions" aria-label="Changelist actions">⋯</button>
</div>
<div class="files-header" id="files-header" style="display:none">
  <label class="opt" style="margin:0"><input type="checkbox" id="select-all"> Select All</label>
  <span class="seg" role="group" aria-label="File view mode">
    <button id="mode-flat" class="active" aria-pressed="true" title="Flat list">List</button>
    <button id="mode-tree" aria-pressed="false" title="Group by directory">Tree</button>
  </span>
</div>
<div class="files" id="files"></div>
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
// ── 勾选集/视图模式按仓库分区（v2，issue #107）：勾选是相对路径集合，跨仓库本就错位；
// 切换仓库换装载互不串扰；无 v2 时从旧平铺结构一次性升级（旧值归首个见到的仓库）。──
const persistedRaw = vscode.getState() || {};
let persistedRepo = '';
let persistedByRepo = {};
if (persistedRaw.v === 2 && persistedRaw.byRepo) {
  persistedByRepo = persistedRaw.byRepo;
} else if (persistedRaw.checked || persistedRaw.mode || persistedRaw.collapsed) {
  persistedByRepo = { '': { checked: persistedRaw.checked, mode: persistedRaw.mode, collapsed: persistedRaw.collapsed } };
}
let checked = new Set();
let mode = 'flat';
let collapsed = new Set();
function loadPersistedFor(repoRoot) {
  persistedRepo = repoRoot;
  const s = persistedByRepo[repoRoot] || persistedByRepo[''] || {};
  checked = new Set(s.checked || []);
  mode = s.mode === 'tree' ? 'tree' : 'flat';
  collapsed = new Set(s.collapsed || []);
}
function saveState() {
  persistedByRepo[persistedRepo] = { checked: Array.from(checked), mode: mode, collapsed: Array.from(collapsed) };
  vscode.setState({ v: 2, byRepo: persistedByRepo });
}
let conventionalEnabled = true;
let templateApplied = false;
let curFiles = [];
let curTree = [];
const INDENT = 14;
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
const filesHeaderEl = document.getElementById('files-header');
const clSwitchEl = document.getElementById('cl-switch');
const clMenuEl = document.getElementById('cl-menu');
const modeFlatEl = document.getElementById('mode-flat');
const modeTreeEl = document.getElementById('mode-tree');

let msgTimer = null;
msgEl.addEventListener('input', function () {
  clearTimeout(msgTimer);
  msgTimer = setTimeout(function () {
    vscode.postMessage({ type: 'messageChanged', payload: { message: msgEl.value } });
  }, 200);
});

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
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.color = 'var(--vscode-' + f.themeColor.replace(/\\./g, '-') + ')';
  dot.textContent = '\\u25CF';
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
  filesEl.appendChild(frag);
}

function renderTree(tree, files) {
  const frag = document.createDocumentFragment();
  tree.forEach(function (n) { renderNode(n, 0, frag, files); });
  filesEl.appendChild(frag);
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
    tw.className = 'tree-twist';
    tw.textContent = isCol ? '\\u25B8' : '\\u25BE';
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
  filesEl.innerHTML = '';
  if (!curFiles || curFiles.length === 0) {
    filesHeaderEl.style.display = 'none';
    filesEl.innerHTML = EMPTY_HTML;
    return;
  }
  filesHeaderEl.style.display = '';
  if (mode === 'tree') { renderTree(curTree, curFiles); } else { renderFlat(curFiles); }
  syncSelectAll();
}

function updateModeButtons() {
  modeFlatEl.classList.toggle('active', mode === 'flat');
  modeTreeEl.classList.toggle('active', mode === 'tree');
  modeFlatEl.setAttribute('aria-pressed', String(mode === 'flat'));
  modeTreeEl.setAttribute('aria-pressed', String(mode === 'tree'));
}
function setMode(m) { if (mode === m) return; mode = m; saveState(); updateModeButtons(); renderList(); }
modeFlatEl.addEventListener('click', function () { setMode('flat'); });
modeTreeEl.addEventListener('click', function () { setMode('tree'); });

selectAllEl.addEventListener('change', function () {
  const want = selectAllEl.checked;
  curFiles.forEach(function (f) { if (want) checked.add(f.path); else checked.delete(f.path); });
  filesEl.querySelectorAll('.file-cb').forEach(function (cb) { cb.checked = want; });
  saveState(); updateDirStates();
});

function renderChangelists(list, activeId) {
  clSwitchEl.innerHTML = '';
  (list || []).forEach(function (c) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name + ' (' + c.count + ')';
    if (c.id === activeId) opt.selected = true;
    clSwitchEl.appendChild(opt);
  });
}
clSwitchEl.addEventListener('change', function () { vscode.postMessage({ type: 'commit/setActive', payload: { id: clSwitchEl.value } }); });
clMenuEl.addEventListener('click', function () { vscode.postMessage({ type: 'commit/changelistMenu', payload: { id: clSwitchEl.value } }); });

function renderRecent(messages) {
  recentEl.innerHTML = '';
  if (!messages || !messages.length) return;
  const label = document.createElement('span');
  label.className = 'recent-label';
  label.textContent = 'Recent: ';
  recentEl.appendChild(label);
  messages.slice(0, 5).forEach(function (m) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = m.split('\\n')[0].slice(0, 40);
    chip.title = m;
    chip.addEventListener('click', function () {
      msgEl.value = m;
      vscode.postMessage({ type: 'messageChanged', payload: { message: msgEl.value } });
    });
    recentEl.appendChild(chip);
  });
}

function showValidation(v) {
  valEl.className = 'validation ' + v.severity;
  if (v.severity === 'ok') {
    valEl.textContent = conventionalEnabled ? '\\u2713 Valid Conventional Commits' : '';
  } else {
    valEl.textContent = (v.severity === 'error' ? '\\u26A0 ' : '\\u2139 ') + (v.reason || '');
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
    loadPersistedFor(p.repoRoot || '');
    curFiles = p.files || [];
    curTree = p.tree || [];
    reconcileChecked(curFiles);
    pruneCollapsed(curTree);
    renderChangelists(p.changelists, p.activeChangelistId);
    updateModeButtons();
    renderList();
    renderRecent(p.recentMessages);
    conventionalEnabled = p.conventionalEnabled;
    if (!templateApplied && p.template && !msgEl.value) {
      msgEl.value = p.template;
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

function getNonce(): string {
	return crypto.randomBytes(16).toString('base64');
}
