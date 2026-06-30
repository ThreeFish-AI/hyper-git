import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { getDecoration } from '../../engine/scm-mapping/status-decoration';
import type { CommitRequest } from '../commit/commit-service';
import type { ChangelistRegistry } from '../changelist-registry';
import type { ChangeItem, GitRepositoryService } from '../git-repository-service';
import type { CommitFileItem, CommitViewState, HostToWebviewMessage, WebviewToHostMessage } from '../../shared/protocol';
import type { CommitService } from '../commit/commit-service';
import { getBaseStyles } from './shared-styles';

/**
 * Commit 提交窗口（WebviewView，自绘提交面板）。
 *
 * 文件勾选 + 多行 Commit Message 编辑器 + Amend/sign-off/skip-hooks 选项 + Commit/Commit and Push 按钮 +
 * Conventional Commits 实时校验 + 最近消息复用。选中态由 webview 端管理（host 不回写，避免覆盖用户操作）。
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
		view.onDidDispose(() => msgSub.dispose());
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

	private buildFiles(): CommitFileItem[] {
		const changes = this.service.getChanges();
		const groups = this.registry.getGroups(changes, (c) => c.relativePath);
		const active = groups.find((g) => g.active) ?? groups[0];
		return (active?.items ?? []).map((c) => this.toFileItem(c));
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
		const state: CommitViewState = {
			template: this.commit.getTemplate(),
			recentMessages: this.commit.getRecentMessages(),
			activeChangelistName: this.registry.getDef(this.registry.activeChangelistId)?.name ?? 'Default',
			files: this.buildFiles(),
			conventionalEnabled: this.commit.conventionalEnabled(),
			busy: false,
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
.cl-header { font-weight: 600; margin-bottom: var(--hg-space-1); }
.files { max-height: 220px; overflow-y: auto; border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.3)); border-radius: var(--hg-radius-control); margin-bottom: var(--hg-space-2); }
.file { display: flex; align-items: center; gap: 6px; padding: 2px 6px; cursor: pointer; }
.file:hover { background: var(--vscode-list-hoverBackground); }
.file .dot { font-size: 14px; line-height: 1; }
.file .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file .dir { margin-left: auto; color: var(--vscode-descriptionForeground); font-size: 11px; white-space: nowrap; }
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
.files-header { display: flex; align-items: center; justify-content: flex-end; min-height: 18px; padding: 0 6px; color: var(--vscode-descriptionForeground); }
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
<div class="cl-header">Active Changelist: <span id="cl-name">—</span></div>
<div class="files-header" id="files-header" style="display:none"><label class="opt" style="margin:0"><input type="checkbox" id="select-all"> Select All</label></div>
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
const persisted = vscode.getState();
const checked = new Set(persisted && persisted.checked ? persisted.checked : []);
function saveChecked() { vscode.setState({ checked: Array.from(checked) }); }
let conventionalEnabled = true;
let templateApplied = false;
const filesEl = document.getElementById('files');
const msgEl = document.getElementById('message');
const valEl = document.getElementById('validation');
const recentEl = document.getElementById('recent');
const clNameEl = document.getElementById('cl-name');
const commitBtn = document.getElementById('commit-btn');
const commitPushBtn = document.getElementById('commit-push-btn');
const amendEl = document.getElementById('amend');
const signoffEl = document.getElementById('signoff');
const skipHooksEl = document.getElementById('skipHooks');
const toastEl = document.getElementById('toast');
const selectAllEl = document.getElementById('select-all');
const filesHeaderEl = document.getElementById('files-header');

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

function syncSelectAll() {
  const boxes = document.querySelectorAll('#files input[type=checkbox]');
  if (boxes.length === 0) { selectAllEl.checked = false; return; }
  selectAllEl.checked = Array.from(boxes).every(function (cb) { return cb.checked; });
}

function renderFiles(files) {
  filesEl.innerHTML = '';
  if (!files || files.length === 0) {
    filesHeaderEl.style.display = 'none';
    filesEl.innerHTML = '<div class="files-empty">No changes in this changelist.<br>Stage files from the Changes view to commit them.</div>';
    return;
  }
  filesHeaderEl.style.display = '';
  const present = new Set();
  files.forEach(function (f) {
    present.add(f.path);
    if (!checked.has(f.path)) checked.add(f.path);
    const row = document.createElement('label');
    row.className = 'file';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.path = f.path;
    cb.checked = checked.has(f.path);
    cb.addEventListener('change', function () { if (cb.checked) checked.add(f.path); else checked.delete(f.path); saveChecked(); syncSelectAll(); });
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.color = 'var(--vscode-' + f.themeColor.replace(/\\./g, '-') + ')';
    dot.textContent = '\\u25CF';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = f.label;
    name.title = f.path;
    const dir = document.createElement('span');
    dir.className = 'dir';
    dir.textContent = f.dir && f.dir !== '.' ? f.dir : '';
    row.appendChild(cb); row.appendChild(dot); row.appendChild(name); row.appendChild(dir);
    filesEl.appendChild(row);
  });
  Array.from(checked).forEach(function (p) { if (!present.has(p)) checked.delete(p); });
  saveChecked();
  syncSelectAll();
}

selectAllEl.addEventListener('change', function () {
  const want = selectAllEl.checked;
  document.querySelectorAll('#files input[type=checkbox]').forEach(function (cb) {
    cb.checked = want;
    const p = cb.dataset.path;
    if (p) { if (want) { checked.add(p); } else { checked.delete(p); } }
  });
  saveChecked();
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
    clNameEl.textContent = p.activeChangelistName || '—';
    renderFiles(p.files);
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
