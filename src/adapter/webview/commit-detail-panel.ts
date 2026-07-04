import * as crypto from 'crypto';
import * as vscode from 'vscode';
import type { GitRepositoryService } from '../git-repository-service';
import type { GitHubCiService } from '../ci/github-ci-service';
import type { CommitDetailVM, CommitDetailWebviewToHostMessage } from '../../shared/protocol';
import { parseShortStat } from '../../engine/log/commit-files';
import { commitWebUrl } from '../../engine/ci/remote-parser';
import { formatRelative, formatAbsolute } from '../../engine/log/format-time';
import { getBaseStyles } from './shared-styles';

/** git show 单条元信息的字段分隔符（NUL，与 log-line LOG_GRAPH_FORMAT 同范式）。 */
const SHOW_FORMAT = '%H%x00%s%x00%b%x00%an%x00%ae%x00%aI%x00%cn%x00%cI%x00%P';
const BODY_CAP = 4000;

/**
 * Commit 详情面板（编辑器区 WebviewPanel，对齐官方 Source Control Graph 的提交详情）。
 *
 * 交互：GRAPH 侧栏悬停提交 → host 组装 {@link CommitDetailVM} → 本面板在编辑器区（Beside）显示，
 * `preserveFocus` 不抢焦点；悬停切换只 `postMessage` 换数据 + `reveal`，不反复 create/dispose。
 *
 * 分层：数据取用 host 侧 git（adapter），格式化/解析复用 engine 纯函数；面板 webview 仅负责渲染。
 * 单例：跨悬停复用同一 panel（`current`），用户手动关闭 → `onDidDispose` 置空 → 下次悬停重建。
 */
export class CommitDetailPanel {
	private static current: CommitDetailPanel | undefined;
	private readonly panel: vscode.WebviewPanel;
	private disposed = false;
	private reqSeq = 0;
	private lastHash: string | undefined;

	private constructor(
		private readonly service: GitRepositoryService,
		private readonly ciService: GitHubCiService,
	) {
		this.panel = vscode.window.createWebviewPanel(
			'hyperGit.commitDetail',
			'Commit',
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
			{ enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
		);
		this.panel.webview.html = CommitDetailPanel.renderShellHtml();
		this.panel.webview.onDidReceiveMessage((m: CommitDetailWebviewToHostMessage) => {
			if (m?.type === 'commitDetail/openExternal') {
				void this.ciService.openExternal(m.payload.url);
			}
		});
		this.panel.onDidDispose(() => {
			this.disposed = true;
			if (CommitDetailPanel.current === this) {
				CommitDetailPanel.current = undefined;
			}
		});
	}

	/** 显示（或更新）指定提交的详情面板。单例复用，不抢焦点。 */
	static async show(service: GitRepositoryService, ciService: GitHubCiService, hash: string): Promise<void> {
		if (!CommitDetailPanel.current) {
			CommitDetailPanel.current = new CommitDetailPanel(service, ciService);
		}
		await CommitDetailPanel.current.update(hash);
	}

	private async update(hash: string): Promise<void> {
		if (this.lastHash === hash && this.panel.visible) {
			return; // 已在显示同一提交（连续悬停/方向键去重）。
		}
		const seq = ++this.reqSeq;
		const vm = await this.buildDetailVM(hash);
		if (this.disposed || seq !== this.reqSeq) {
			return; // 面板已关闭，或已被更晚的悬停请求超越 → 丢弃过期响应。
		}
		this.lastHash = vm ? hash : undefined;
		this.panel.title = vm ? `${vm.shortHash} · Commit` : 'Commit';
		void this.panel.webview.postMessage({ type: 'commitDetail/data', payload: vm });
		this.panel.reveal(vscode.ViewColumn.Beside, /* preserveFocus */ true);
	}

	/** host 侧一次取齐：基础字段（git show）+ 预格式化时间 + 变更统计 + 可选 GitHub 提交页 URL。 */
	private async buildDetailVM(hash: string): Promise<CommitDetailVM | null> {
		if (!this.service.repo) {
			return null;
		}
		try {
			const raw = await this.service.execGit(['show', '-s', `--format=${SHOW_FORMAT}`, hash]);
			const f = raw.split('\0');
			if (f.length < 9 || !f[0]) {
				return null;
			}
			const [fullHash, subject, body, authorName, authorEmail, authorDate, committerName, committerDate, parentsRaw] = f;
			const stat = parseShortStat(
				await this.service.execGit(['diff-tree', '--no-commit-id', '--shortstat', '-r', '--root', hash]),
			);
			const remote = this.ciService.getGitHubRemote();
			const cappedBody = body.length > BODY_CAP ? `${body.slice(0, BODY_CAP)}…` : body.replace(/\s+$/, '');
			return {
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
				parents: parentsRaw ? parentsRaw.trim().split(/\s+/).filter(Boolean) : [],
				stat,
				githubUrl: remote ? commitWebUrl(remote, fullHash) : undefined,
			};
		} catch {
			return null; // 坏 hash / git 失败 → 面板空态，不弹模态（对齐 sendCommitFiles 静默降级）。
		}
	}

	private static renderShellHtml(): string {
		const nonce = crypto.randomBytes(16).toString('base64');
		const csp = ['default-src \'none\'', 'style-src \'unsafe-inline\'', `script-src 'nonce-${nonce}'`].join('; ');
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
${getBaseStyles()}
* { box-sizing: border-box; }
body { margin: 0; padding: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
#empty { padding: 32px 20px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 12px; }
#detail { display: none; padding: 16px 20px; max-width: 860px; }
#detail.show { display: block; }
.cd-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.cd-avatar { flex: 0 0 auto; width: 28px; height: 28px; border-radius: 50%; background: var(--vscode-badge-background, rgba(128,128,128,.25)); color: var(--vscode-badge-foreground, var(--vscode-foreground)); display: inline-flex; align-items: center; justify-content: center; }
.cd-avatar svg { width: 18px; height: 18px; opacity: 0.85; }
.cd-who { display: flex; flex-direction: column; min-width: 0; }
.cd-author { font-weight: 600; }
.cd-time { font-size: 11px; color: var(--vscode-descriptionForeground); }
.cd-msg { margin: 0 0 16px; }
.cd-subj { font-size: 14px; font-weight: 600; line-height: 1.4; word-break: break-word; }
.cd-body { margin-top: 8px; white-space: pre-wrap; word-break: break-word; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; line-height: 1.5; color: var(--vscode-foreground); opacity: 0.92; }
.cd-stat { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.25)); border-bottom: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.25)); font-size: 12px; }
.cd-stat .files { color: var(--vscode-descriptionForeground); }
.cd-stat .ins { color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950); font-variant-numeric: tabular-nums; }
.cd-stat .del { color: var(--vscode-gitDecoration-deletedResourceForeground, #f14c4c); font-variant-numeric: tabular-nums; }
.cd-foot { display: flex; align-items: center; gap: 14px; margin-top: 14px; flex-wrap: wrap; }
.cd-sha { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; color: var(--vscode-descriptionForeground); word-break: break-all; }
.cd-gh { color: var(--vscode-textLink-foreground); cursor: pointer; font-size: 12px; }
.cd-gh:hover { text-decoration: underline; }
.cd-gh:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; border-radius: 2px; }
.cd-gh svg { width: 13px; height: 13px; vertical-align: -2px; margin-right: 3px; }
</style>
</head>
<body>
<div id="empty">Hover a commit in the Graph to see its details.</div>
<div id="detail" role="document"></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const emptyEl = document.getElementById('empty');
const detailEl = document.getElementById('detail');
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const ICO_PERSON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 1.5c-2.5 0-6 1.25-6 3.5V14h12v-1c0-2.25-3.5-3.5-6-3.5z"/></svg>';
const ICO_GH = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 .2a8 8 0 0 0-2.53 15.6c.4.07.55-.17.55-.38l-.01-1.34c-2.23.49-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.83-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.52.56.83 1.28.83 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.2c0 .21.15.46.55.38A8 8 0 0 0 8 .2z"/></svg>';
function stat(s) {
  // 对齐官方 GRAPH：完整文字 "N files changed, X insertions(+), Y deletions(-)"，逗号分隔；
  // 绿/红着色覆盖「数字 + insertions(+) / deletions(-)」整段。
  const parts = ['<span class="files">' + s.files + (s.files === 1 ? ' file' : ' files') + ' changed</span>'];
  if (s.insertions > 0) parts.push('<span class="ins">' + s.insertions + (s.insertions === 1 ? ' insertion(+)' : ' insertions(+)') + '</span>');
  if (s.deletions > 0) parts.push('<span class="del">' + s.deletions + (s.deletions === 1 ? ' deletion(-)' : ' deletions(-)') + '</span>');
  return parts.join(', ');
}
function render(vm) {
  if (!vm) { detailEl.classList.remove('show'); emptyEl.style.display = 'block'; emptyEl.textContent = 'Commit details unavailable.'; return; }
  emptyEl.style.display = 'none';
  // 头部对齐官方 GRAPH：作者名独占一行；第二行 = 邮箱 · 相对时间 (绝对时间)，与时间同色。
  // 相对时间与括号绝对时间之间仅空格（无 ·），绝对时间无秒。
  const timeBits = [];
  if (vm.authorDateRel) timeBits.push(esc(vm.authorDateRel));
  if (vm.authorDateAbs) timeBits.push('(' + esc(vm.authorDateAbs) + ')');
  const meta = [];
  if (vm.authorEmail) meta.push(esc(vm.authorEmail));
  if (timeBits.length) meta.push(timeBits.join(' '));
  const p = [];
  p.push('<div class="cd-head"><span class="cd-avatar">' + ICO_PERSON + '</span><span class="cd-who">'
    + '<span class="cd-author">' + esc(vm.authorName) + '</span>'
    + (meta.length ? '<span class="cd-time">' + meta.join(' · ') + '</span>' : '')
    + '</span></div>');
  p.push('<div class="cd-msg"><div class="cd-subj">' + esc(vm.subject) + '</div>' + (vm.body ? '<div class="cd-body">' + esc(vm.body) + '</div>' : '') + '</div>');
  p.push('<div class="cd-stat">' + stat(vm.stat) + '</div>');
  const gh = vm.githubUrl ? '<span class="cd-gh" role="link" tabindex="0" data-url="' + esc(vm.githubUrl) + '">' + ICO_GH + 'Open on GitHub</span>' : '';
  p.push('<div class="cd-foot"><span class="cd-sha">' + esc(vm.hash) + '</span>' + gh + '</div>');
  detailEl.innerHTML = p.join('');
  detailEl.classList.add('show');
}
function openGh(el) { const u = el.getAttribute('data-url'); if (u) vscode.postMessage({ type: 'commitDetail/openExternal', payload: { url: u } }); }
detailEl.addEventListener('click', function (e) { const t = e.target.closest('.cd-gh'); if (t) openGh(t); });
detailEl.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { const t = e.target.closest('.cd-gh'); if (t) { e.preventDefault(); openGh(t); } } });
window.addEventListener('message', function (e) { const m = e.data; if (m && m.type === 'commitDetail/data') render(m.payload); });
</script>
</body>
</html>`;
	}
}
