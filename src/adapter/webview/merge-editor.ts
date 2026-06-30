import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { GitRepositoryService } from '../git-repository-service';
import { diff3, type MergeHunk } from '../../engine/merge/diff3';
import { parseConflictState } from '../../engine/git-state/conflict-detector';
import { getBaseStyles } from './shared-styles';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * 自绘 3-way Merge Editor（WebviewPanel）—— 自绘 3-way 冲突解决编辑器。
 *
 * 数据：经 `git show :1/:2/:3:<path>` 取 base/ours/theirs，diff3 产出 hunks。
 * UI：stable 段只读展示；conflict 段三栏（OURS | RESULT 可编辑 | THEIRS），Accept 按钮填 RESULT。
 * 保存：拼装全量结果写回工作区文件 + `git add` 标记已解决；残留冲突标记时二次确认。
 */
export class MergeEditorWebview {
	static async openForFile(service: GitRepositoryService, filePath: string): Promise<void> {
		const repo = service.repo;
		if (!repo) {
			void vscode.window.showWarningMessage('No Git repository found');
			return;
		}
		let base: string;
		let ours: string;
		let theirs: string;
		try {
			// 并行取三阶段（冲突文件的 index stage 1/2/3）
			[base, ours, theirs] = await Promise.all([
				service.execGit(['show', `:1:${filePath}`]),
				service.execGit(['show', `:2:${filePath}`]),
				service.execGit(['show', `:3:${filePath}`]),
			]);
		} catch (e) {
			void vscode.window.showErrorMessage(`Failed to read conflict stages (file may have no conflicts): ${errMsg(e)}`);
			return;
		}
		const hunks = diff3(splitLines(base), splitLines(ours), splitLines(theirs));
		const conflicts = hunks.filter((h) => h.kind === 'conflict').length;
		if (conflicts === 0) {
			// 无冲突：直接取合并结果写回 + add
			const merged = hunks.flatMap((h) => (h.kind === 'stable' ? h.content : []));
			await MergeEditorWebview.saveResult(service, filePath, merged.join('\n') + '\n');
			void vscode.window.showInformationMessage(`"${filePath}" has no conflicts; auto-merged and marked resolved`);
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			'hyperGit.mergeEditor',
			`Merge — ${filePath} · Hyper Git`,
			vscode.ViewColumn.Active,
			{ enableScripts: true, retainContextWhenHidden: true },
		);
		panel.webview.html = MergeEditorWebview.renderHtml(filePath, hunks, conflicts);
		panel.webview.onDidReceiveMessage(async (msg) => {
			if (msg?.type === 'save' && typeof msg.content === 'string') {
				await MergeEditorWebview.saveResult(service, filePath, msg.content);
				panel.dispose();
			} else if (msg?.type === 'cancel') {
				panel.dispose();
			}
		});
	}

	private static async saveResult(service: GitRepositoryService, filePath: string, content: string): Promise<void> {
		const repo = service.repo;
		if (!repo) {
			return;
		}
		if (/^<<<<<<< /m.test(content) || /^======= *$/m.test(content) || /^>>>>>>> /m.test(content)) {
			const ok = await vscode.window.showWarningMessage(
				'The result still contains conflict markers (<<<<<<< / ======= / >>>>>>>). Force-saving will mark the file as resolved with the markers still in it. Continue?',
				{ modal: true },
				'Force Save',
			);
			if (ok !== 'Force Save') {
				return;
			}
		}
		const abs = path.join(repo.rootUri.fsPath, filePath);
		try {
			await fs.promises.writeFile(abs, content, 'utf8');
			await service.execGit(['add', '--', filePath]);
			void vscode.window.showInformationMessage(`"${filePath}" saved and marked resolved`);
		} catch (e) {
			void vscode.window.showErrorMessage(`Failed to save: ${errMsg(e)}`);
		}
	}

	private static renderHtml(filePath: string, hunks: readonly MergeHunk[], conflicts: number): string {
		const nonce = crypto.randomBytes(16).toString('base64');
		// JSON 注入 <script> 内的 JS 字符串上下文：按 JS-string 转义（反斜杠/引号）+ < → < 防 </script> 破出。
		// 不可用 escapeHtml——其产出 &quot; 在 <script> raw-text 中不被解码，会令 JSON.parse 失败。
		const dataJson = JSON.stringify(hunks)
			.replace(/\\/g, '\\\\')
			.replace(/"/g, '\\"')
			.replace(/</g, '\\u003c');
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>
${getBaseStyles()}
body { margin: 0; padding: 10px 14px; font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
.bar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.bar .path { font-weight: 600; }
.bar .count { color: var(--vscode-editorWarning-foreground, #d29922); }
.bar .spacer { flex: 1; }
.bar .nav { display: inline-flex; align-items: center; gap: 2px; }
.bar .nav #conflict-pos { font-size: 11px; min-width: 46px; text-align: center; color: var(--vscode-descriptionForeground); }
.remaining { font-size: 11px; opacity: 0.75; margin-left: 6px; }
.remaining.has-unresolved { color: var(--vscode-editorWarning-foreground, #d29922); opacity: 1; }
.hunk { margin-bottom: 10px; }
.stable { background: var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,.12)); border-left: 3px solid transparent; padding: 2px 8px; white-space: pre-wrap; font-family: var(--vscode-editor-font-family); }
.conflict { border: 1px solid var(--vscode-inputOption-activeBorder, #d29922); border-radius: 3px; }
.conflict-head { display: flex; align-items: center; gap: 8px; background: var(--vscode-editorWarning-background, rgba(210,153,34,.15)); padding: 3px 8px; font-weight: 600; }
.c-badge { margin-left: auto; font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 9px; border: 1px solid transparent; }
.c-badge.unresolved { color: var(--vscode-editorWarning-foreground, #d29922); border-color: var(--vscode-editorWarning-foreground, #d29922); }
.c-badge.resolved { color: var(--vscode-testing-iconPassed, #3fb950); border-color: var(--vscode-testing-iconPassed, #3fb950); }
.c3 { display: grid; grid-template-columns: 1fr 1.3fr 1fr; gap: 1px; background: var(--vscode-editorWidget-border, rgba(128,128,128,.3)); }
.col { background: var(--vscode-editor-background); padding: 4px 8px; }
.col-label { font-size: 10px; opacity: 0.7; margin-bottom: 3px; text-transform: uppercase; }
.col pre { white-space: pre; overflow-x: auto; font-family: var(--vscode-editor-font-family); margin: 0; min-height: 14px; }
.col textarea { width: 100%; min-height: 60px; resize: vertical; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); font-family: var(--vscode-editor-font-family); font-size: 12px; padding: 4px; box-sizing: border-box; }
.col-actions { margin-top: 4px; display: flex; gap: 4px; }
</style>
</head>
<body>
<div class="bar">
  <span class="path">${escapeHtml(filePath)}</span>
  <span class="count">${conflicts} conflict${conflicts === 1 ? '' : 's'}</span>
  <span class="spacer"></span>
  <span class="nav" id="conflict-nav" role="group" aria-label="Conflict navigation">
    <button class="hg-btn hg-btn--sm" id="prev-conflict" title="Previous conflict" aria-label="Previous conflict">‹</button>
    <span id="conflict-pos" aria-live="polite">—</span>
    <button class="hg-btn hg-btn--sm" id="next-conflict" title="Next conflict" aria-label="Next conflict">›</button>
  </span>
  <button class="hg-btn hg-btn--secondary" id="cancel">Cancel</button>
  <button class="hg-btn" id="save">Save &amp; Mark Resolved<span class="remaining" id="remaining"></span></button>
</div>
<div id="hunks"></div>
<script nonce="${nonce}">
var HUNKS = JSON.parse("${dataJson}");
function lines(pre){ return (pre||[]); }
function markerText(h){
  return "<<<<<<< ours\\n" + lines(h.ours).join("\\n") + "\\n=======\\n" + lines(h.theirs).join("\\n") + "\\n>>>>>>> theirs";
}
function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
var MARKER_RE = /^<<<<<<< |^=======$|^>>>>>>> /m;
function isResolved(ta){ return !!ta && !MARKER_RE.test(ta.value || ''); }
var container = document.getElementById('hunks');
var conflicts = []; // { wrap, ta, badge } —— 仅 conflict hunk，顺序编号 1..N
var cIdx = 0;
HUNKS.forEach(function(h){
  if (h.kind === 'stable') {
    var d = document.createElement('div'); d.className = 'hunk';
    var s = document.createElement('div'); s.className = 'stable';
    s.textContent = (h.content||[]).join('\\n');
    d.appendChild(s); container.appendChild(d);
  } else {
    cIdx += 1; // 顺序编号：仅 conflict 自增（与 save 端收集一致）
    var d = document.createElement('div'); d.className = 'hunk';
    var c = document.createElement('div'); c.className = 'conflict'; c.setAttribute('role','group'); c.setAttribute('aria-label','Conflict #' + cIdx);
    var head = document.createElement('div'); head.className = 'conflict-head';
    var num = document.createElement('span'); num.textContent = 'Conflict #' + cIdx;
    var badge = document.createElement('span'); badge.className = 'c-badge unresolved'; badge.textContent = 'Unresolved';
    head.appendChild(num); head.appendChild(badge);
    c.appendChild(head);
    var grid = document.createElement('div'); grid.className = 'c3';
    // OURS
    var oc = document.createElement('div'); oc.className = 'col';
    oc.innerHTML = '<div class="col-label">Ours</div><pre>' + escapeHtml(lines(h.ours).join('\\n')) + '</pre>';
    var ob = document.createElement('div'); ob.className='col-actions';
    var obtn = document.createElement('button'); obtn.className='hg-btn hg-btn--sm'; obtn.textContent='← Accept Ours';
    obtn.onclick = function(){ ta.value = lines(h.ours).join('\\n'); ta.focus(); refreshConflict(entry); };
    ob.appendChild(obtn); oc.appendChild(ob); grid.appendChild(oc);
    // RESULT
    var rc = document.createElement('div'); rc.className = 'col';
    rc.innerHTML = '<div class="col-label">Result (editable)</div>';
    var ta = document.createElement('textarea'); ta.className = 'hg-input'; ta.value = markerText(h); ta.id = 'result-' + cIdx; ta.setAttribute('aria-label','Conflict #' + cIdx + ' result');
    rc.appendChild(ta);
    var bb = document.createElement('div'); bb.className='col-actions';
    var baseb = document.createElement('button'); baseb.className='hg-btn hg-btn--sm hg-btn--secondary'; baseb.textContent='Accept Base';
    baseb.onclick = function(){ ta.value = lines(h.base).join('\\n'); refreshConflict(entry); };
    bb.appendChild(baseb); rc.appendChild(bb); grid.appendChild(rc);
    // THEIRS
    var tc = document.createElement('div'); tc.className = 'col';
    tc.innerHTML = '<div class="col-label">Theirs</div><pre>' + escapeHtml(lines(h.theirs).join('\\n')) + '</pre>';
    var tb = document.createElement('div'); tb.className='col-actions';
    var tbtn = document.createElement('button'); tbtn.className='hg-btn hg-btn--sm'; tbtn.textContent='Accept Theirs →';
    tbtn.onclick = function(){ ta.value = lines(h.theirs).join('\\n'); ta.focus(); refreshConflict(entry); };
    tb.appendChild(tbtn); tc.appendChild(tb); grid.appendChild(tc);
    c.appendChild(grid); d.appendChild(c); container.appendChild(d);
    var entry = { wrap: d, ta: ta, badge: badge };
    ta.addEventListener('input', function(){ refreshConflict(entry); });
    conflicts.push(entry);
  }
});

function refreshConflict(entry){
  var resolved = isResolved(entry.ta);
  entry.badge.className = 'c-badge ' + (resolved ? 'resolved' : 'unresolved');
  entry.badge.textContent = resolved ? 'Resolved' : 'Unresolved';
  updateCounters();
}
function currentConflictIndex(){
  for (var i = 0; i < conflicts.length; i++){
    var rect = conflicts[i].wrap.getBoundingClientRect();
    if (rect.bottom > 70 && rect.top < window.innerHeight - 50) return i;
  }
  return Math.max(0, conflicts.length - 1);
}
function gotoConflict(i){
  if (!conflicts.length) return;
  i = Math.max(0, Math.min(conflicts.length - 1, i));
  conflicts[i].wrap.scrollIntoView({ block: 'start' });
  conflicts[i].ta.focus({ preventScroll: true });
  updateCounters(i);
}
function updateCounters(focusIdx){
  var posEl = document.getElementById('conflict-pos');
  var remEl = document.getElementById('remaining');
  var total = conflicts.length;
  if (!total) { posEl.textContent = '—'; remEl.textContent = ''; return; }
  var cur = (typeof focusIdx === 'number') ? focusIdx + 1 : currentConflictIndex() + 1;
  posEl.textContent = cur + ' / ' + total;
  var unresolved = conflicts.filter(function(e){ return !isResolved(e.ta); }).length;
  remEl.textContent = unresolved ? (unresolved + ' unresolved') : ' · all resolved';
  remEl.className = 'remaining' + (unresolved ? ' has-unresolved' : '');
}
document.getElementById('prev-conflict').onclick = function(){ gotoConflict(currentConflictIndex() - 1); };
document.getElementById('next-conflict').onclick = function(){ gotoConflict(currentConflictIndex() + 1); };
window.addEventListener('scroll', function(){ updateCounters(); }, { passive: true });
updateCounters();

document.getElementById('save').onclick = function(){
  var result = [];
  var ci = 0;
  HUNKS.forEach(function(h){
    if (h.kind === 'stable') { result.push.apply(result, h.content||[]); }
    else { ci += 1; result.push(document.getElementById('result-' + ci).value); }
  });
  acquireVsCodeApi().postMessage({ type: 'save', content: result.join('\\n') + '\\n' });
};
document.getElementById('cancel').onclick = function(){ acquireVsCodeApi().postMessage({ type: 'cancel' }); };
</script>
</body>
</html>`;
	}
}

function splitLines(s: string): string[] {
	return s.length === 0 ? [] : s.replace(/\n$/, '').split('\n');
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 注册冲突解决命令（Phase 3）：
 * - resolveConflicts：列出冲突文件 → 选择 → 打开 3-way merge editor。
 * - acceptOurs / acceptTheirs：对单个文件快速采用 ours/theirs（git checkout --ours/--theirs + add）。
 */
export function registerMergeCommands(service: GitRepositoryService): vscode.Disposable[] {
	const subs: vscode.Disposable[] = [];

	subs.push(
		vscode.commands.registerCommand('hyperGit.resolveConflicts', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			let paths: readonly string[] = [];
			try {
				const status = await service.execGit(['status', '--porcelain']);
				paths = parseConflictState(status, []).conflictedPaths;
			} catch {
				/* ignore */
			}
			if (paths.length === 0) {
				void vscode.window.showInformationMessage('No conflicted files');
				return;
			}
			const pick = await vscode.window.showQuickPick(
				paths.map((p) => ({ label: p, description: 'conflicted' })),
				{ placeHolder: 'Select a conflicted file to resolve', canPickMany: false },
			);
			if (!pick) {
				return;
			}
			await MergeEditorWebview.openForFile(service, pick.label);
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.acceptOurs', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const file = await pickConflicted(service);
			if (!file) {
				return;
			}
			try {
				await service.execGit(['checkout', '--ours', '--', file]);
				await service.execGit(['add', '--', file]);
				void vscode.window.showInformationMessage(`"${file}" resolved with ours`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.acceptTheirs', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const file = await pickConflicted(service);
			if (!file) {
				return;
			}
			try {
				await service.execGit(['checkout', '--theirs', '--', file]);
				await service.execGit(['add', '--', file]);
				void vscode.window.showInformationMessage(`"${file}" resolved with theirs`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed: ${errMsg(e)}`);
			}
		}),
	);

	return subs;
}

async function pickConflicted(service: GitRepositoryService): Promise<string | undefined> {
	let paths: readonly string[] = [];
	try {
		const status = await service.execGit(['status', '--porcelain']);
		paths = parseConflictState(status, []).conflictedPaths;
	} catch {
		/* ignore */
	}
	if (paths.length === 0) {
		void vscode.window.showInformationMessage('No conflicted files');
		return undefined;
	}
	if (paths.length === 1) {
		return paths[0];
	}
	const pick = await vscode.window.showQuickPick(paths.map((p) => ({ label: p })), { placeHolder: 'Select a conflicted file' });
	return pick?.label;
}
