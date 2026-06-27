import * as path from 'path';
import * as vscode from 'vscode';
import { getDecoration } from '../../engine/scm-mapping/status-decoration';
import type { CommitRequest } from '../commit/commit-service';
import type { ChangelistRegistry } from '../changelist-registry';
import type { ChangeItem, GitRepositoryService } from '../git-repository-service';
import type { CommitFileItem, CommitViewState, HostToWebviewMessage, WebviewToHostMessage } from '../../shared/protocol';
import type { CommitService } from '../commit/commit-service';

/**
 * Commit 提交窗口（WebviewView，自绘 IDEA 风格）。
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
		view.webview.onDidReceiveMessage((msg) => this.onMessage(msg as WebviewToHostMessage));
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
			status: decoration.letter,
			statusName: c.status,
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
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
body { margin: 0; padding: 8px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); font-size: var(--vscode-font-size); }
.cl-header { font-weight: 600; margin-bottom: 6px; opacity: 0.9; }
.files { max-height: 220px; overflow-y: auto; border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.3)); border-radius: 3px; margin-bottom: 8px; }
.file { display: flex; align-items: center; gap: 6px; padding: 2px 6px; cursor: pointer; }
.file:hover { background: var(--vscode-list-hoverBackground); }
.file .dot { font-size: 14px; line-height: 1; }
.file .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file .dir { margin-left: auto; opacity: 0.6; font-size: 11px; white-space: nowrap; }
textarea { width: 100%; box-sizing: border-box; resize: vertical; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; padding: 6px; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-font-size); }
.validation { font-size: 11px; min-height: 16px; margin: 4px 2px; }
.validation.ok { color: var(--vscode-testing-iconPassed, #3fb950); }
.validation.warning { color: var(--vscode-editorWarning-foreground, #d29922); }
.validation.error { color: var(--vscode-errorForeground, #f85149); }
.recent { margin: 4px 0 8px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.recent-label { opacity: 0.6; font-size: 11px; }
.chip { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 9px; padding: 1px 8px; font-size: 11px; cursor: pointer; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip:hover { opacity: 0.85; }
.opt { display: block; font-size: 12px; margin: 3px 2px; opacity: 0.95; }
.buttons { display: flex; gap: 6px; margin-top: 10px; }
button.primary, .buttons button { flex: 1; padding: 6px 10px; border: none; border-radius: 2px; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-size: 13px; }
.buttons button:last-child { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
button:disabled { opacity: 0.5; cursor: default; }
.toast { font-size: 12px; margin-top: 8px; min-height: 16px; }
.toast.ok { color: var(--vscode-testing-iconPassed, #3fb950); }
.toast.err { color: var(--vscode-errorForeground, #f85149); }
</style>
</head>
<body>
<div class="cl-header">活动 Changelist：<span id="cl-name">—</span></div>
<div class="files" id="files"></div>
<textarea id="message" rows="4" placeholder="提交信息（Conventional Commits：type(scope): description）" spellcheck="false"></textarea>
<div id="validation" class="validation"></div>
<div class="recent" id="recent"></div>
<label class="opt"><input type="checkbox" id="amend"> Amend 上次提交</label>
<label class="opt"><input type="checkbox" id="signoff"> 追加 Signed-off-by</label>
<label class="opt"><input type="checkbox" id="skipHooks"> 跳过 Git hooks（--no-verify）</label>
<div class="buttons">
<button id="commit-btn" class="primary">Commit</button>
<button id="commit-push-btn">Commit and Push</button>
</div>
<div id="toast" class="toast"></div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const checked = new Set();
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

let msgTimer = null;
msgEl.addEventListener('input', function () {
  clearTimeout(msgTimer);
  msgTimer = setTimeout(function () {
    vscode.postMessage({ type: 'messageChanged', payload: { message: msgEl.value } });
  }, 200);
});

function setBusy(b) { commitBtn.disabled = b; commitPushBtn.disabled = b; }

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

function renderFiles(files) {
  filesEl.innerHTML = '';
  const present = new Set();
  files.forEach(function (f) {
    present.add(f.path);
    if (!checked.has(f.path)) checked.add(f.path);
    const row = document.createElement('label');
    row.className = 'file';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked.has(f.path);
    cb.addEventListener('change', function () { if (cb.checked) checked.add(f.path); else checked.delete(f.path); });
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
}

function renderRecent(messages) {
  recentEl.innerHTML = '';
  if (!messages || !messages.length) return;
  const label = document.createElement('span');
  label.className = 'recent-label';
  label.textContent = '最近：';
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
    valEl.textContent = conventionalEnabled ? '\\u2713 符合 Conventional Commits' : '';
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
      toast('提交成功', false);
      msgEl.value = '';
      amendEl.checked = false; signoffEl.checked = false; skipHooksEl.checked = false;
      vscode.postMessage({ type: 'messageChanged', payload: { message: '' } });
    } else {
      toast(m.payload.error || '提交失败', true);
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
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
