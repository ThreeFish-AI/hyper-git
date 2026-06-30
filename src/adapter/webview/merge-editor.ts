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
			void vscode.window.showWarningMessage('未找到 Git 仓库');
			return;
		}
		let base = '';
		let ours = '';
		let theirs = '';
		try {
			// 并行取三阶段（冲突文件的 index stage 1/2/3）
			[base, ours, theirs] = await Promise.all([
				service.execGit(['show', `:1:${filePath}`]),
				service.execGit(['show', `:2:${filePath}`]),
				service.execGit(['show', `:3:${filePath}`]),
			]);
		} catch (e) {
			void vscode.window.showErrorMessage(`读取冲突阶段失败（文件可能无冲突）：${errMsg(e)}`);
			return;
		}
		const hunks = diff3(splitLines(base), splitLines(ours), splitLines(theirs));
		const conflicts = hunks.filter((h) => h.kind === 'conflict').length;
		if (conflicts === 0) {
			// 无冲突：直接取合并结果写回 + add
			const merged = hunks.flatMap((h) => (h.kind === 'stable' ? h.content : []));
			await MergeEditorWebview.saveResult(service, filePath, merged.join('\n') + '\n');
			void vscode.window.showInformationMessage(`「${filePath}」无冲突，已自动合并并标记已解决`);
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
				'结果仍含冲突标记（<<<<<<< / ======= / >>>>>>>），强制保存将把带标记的内容标记为已解决。继续？',
				{ modal: true },
				'强制保存',
			);
			if (ok !== '强制保存') {
				return;
			}
		}
		const abs = path.join(repo.rootUri.fsPath, filePath);
		try {
			await fs.promises.writeFile(abs, content, 'utf8');
			await service.execGit(['add', '--', filePath]);
			void vscode.window.showInformationMessage(`「${filePath}」已保存并标记为已解决`);
		} catch (e) {
			void vscode.window.showErrorMessage(`保存失败：${errMsg(e)}`);
		}
	}

	private static renderHtml(filePath: string, hunks: readonly MergeHunk[], conflicts: number): string {
		const nonce = crypto.randomBytes(16).toString('base64');
		const dataJson = escapeHtml(JSON.stringify(hunks));
		return `<!DOCTYPE html>
<html lang="zh-CN">
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
.hunk { margin-bottom: 10px; }
.stable { background: var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,.12)); border-left: 3px solid transparent; padding: 2px 8px; white-space: pre-wrap; font-family: var(--vscode-editor-font-family); }
.conflict { border: 1px solid var(--vscode-inputOption-activeBorder, #d29922); border-radius: 3px; }
.conflict-head { background: var(--vscode-editorWarning-background, rgba(210,153,34,.15)); padding: 3px 8px; font-weight: 600; }
.c3 { display: grid; grid-template-columns: 1fr 1.3fr 1fr; gap: 1px; background: var(--vscode-editorWidget-border, rgba(128,128,128,.3)); }
.col { background: var(--vscode-editor-background); padding: 4px 8px; }
.col-label { font-size: 10px; opacity: 0.7; margin-bottom: 3px; text-transform: uppercase; }
.col pre { white-space: pre-wrap; font-family: var(--vscode-editor-font-family); margin: 0; min-height: 14px; }
.col textarea { width: 100%; min-height: 60px; resize: vertical; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); font-family: var(--vscode-editor-font-family); font-size: 12px; padding: 4px; box-sizing: border-box; }
.col-actions { margin-top: 4px; display: flex; gap: 4px; }
</style>
</head>
<body>
<div class="bar">
  <span class="path">${escapeHtml(filePath)}</span>
  <span class="count">${conflicts} 个冲突</span>
  <span class="spacer"></span>
  <button class="hg-btn hg-btn--secondary" id="cancel">取消</button>
  <button class="hg-btn" id="save">保存并标记已解决</button>
</div>
<div id="hunks"></div>
<script nonce="${nonce}">
var HUNKS = JSON.parse("${dataJson}");
function lines(pre){ return (pre||[]); }
function markerText(h){
  return "<<<<<<< ours\\n" + lines(h.ours).join("\\n") + "\\n=======\\n" + lines(h.theirs).join("\\n") + "\\n>>>>>>> theirs";
}
function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
var container = document.getElementById('hunks');
HUNKS.forEach(function(h, idx){
  if (h.kind === 'stable') {
    var d = document.createElement('div'); d.className = 'hunk';
    var s = document.createElement('div'); s.className = 'stable';
    s.textContent = (h.content||[]).join('\\n');
    d.appendChild(s); container.appendChild(d);
  } else {
    var d = document.createElement('div'); d.className = 'hunk';
    var c = document.createElement('div'); c.className = 'conflict';
    var head = document.createElement('div'); head.className = 'conflict-head'; head.textContent = '冲突 #' + (idx);
    c.appendChild(head);
    var grid = document.createElement('div'); grid.className = 'c3';
    // OURS
    var oc = document.createElement('div'); oc.className = 'col';
    oc.innerHTML = '<div class="col-label">Ours</div><pre>' + escapeHtml(lines(h.ours).join('\\n')) + '</pre>';
    var ob = document.createElement('div'); ob.className='col-actions';
    var obtn = document.createElement('button'); obtn.className='hg-btn hg-btn--sm'; obtn.textContent='← 采用 Ours';
    obtn.onclick = function(){ ta.value = lines(h.ours).join('\\n'); ta.focus(); };
    ob.appendChild(obtn); oc.appendChild(ob); grid.appendChild(oc);
    // RESULT
    var rc = document.createElement('div'); rc.className = 'col';
    rc.innerHTML = '<div class="col-label">Result（可编辑）</div>';
    var ta = document.createElement('textarea'); ta.value = markerText(h); ta.id = 'result-' + idx;
    rc.appendChild(ta);
    var bb = document.createElement('div'); bb.className='col-actions';
    var baseb = document.createElement('button'); baseb.className='hg-btn hg-btn--sm hg-btn--secondary'; baseb.textContent='采用 Base';
    baseb.onclick = function(){ ta.value = lines(h.base).join('\\n'); };
    bb.appendChild(baseb); rc.appendChild(bb); grid.appendChild(rc);
    // THEIRS
    var tc = document.createElement('div'); tc.className = 'col';
    tc.innerHTML = '<div class="col-label">Theirs</div><pre>' + escapeHtml(lines(h.theirs).join('\\n')) + '</pre>';
    var tb = document.createElement('div'); tb.className='col-actions';
    var tbtn = document.createElement('button'); tbtn.className='hg-btn hg-btn--sm'; tbtn.textContent='采用 Theirs →';
    tbtn.onclick = function(){ ta.value = lines(h.theirs).join('\\n'); ta.focus(); };
    tb.appendChild(tbtn); tc.appendChild(tb); grid.appendChild(tc);
    c.appendChild(grid); d.appendChild(c); container.appendChild(d);
  }
});
document.getElementById('save').onclick = function(){
  var result = [];
  HUNKS.forEach(function(h, idx){
    if (h.kind === 'stable') { result.push.apply(result, h.content||[]); }
    else { var v = document.getElementById('result-' + idx).value; result.push(v); }
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
				void vscode.window.showInformationMessage('当前无冲突文件');
				return;
			}
			const pick = await vscode.window.showQuickPick(
				paths.map((p) => ({ label: p, description: '冲突文件' })),
				{ placeHolder: '选择要解决的冲突文件', canPickMany: false },
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
				void vscode.window.showInformationMessage(`「${file}」已采用 ours`);
			} catch (e) {
				void vscode.window.showErrorMessage(`失败：${errMsg(e)}`);
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
				void vscode.window.showInformationMessage(`「${file}」已采用 theirs`);
			} catch (e) {
				void vscode.window.showErrorMessage(`失败：${errMsg(e)}`);
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
		void vscode.window.showInformationMessage('当前无冲突文件');
		return undefined;
	}
	if (paths.length === 1) {
		return paths[0];
	}
	const pick = await vscode.window.showQuickPick(paths.map((p) => ({ label: p })), { placeHolder: '选择冲突文件' });
	return pick?.label;
}
