import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { GitRepositoryService } from '../git-repository-service';
import { handleGitConflict } from '../conflict-ui';
import { type RebaseTodoItem, isValidAction, serializeTodo } from '../../engine/rebase/todo';
import { getBaseStyles } from './shared-styles';

interface RebaseCommit {
	readonly hash: string;
	readonly subject: string;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * reword 的 GIT_EDITOR helper 脚本（Node）。
 *
 * git 对每个 reword 提交以 `node helper <msgfile>` 调用本脚本；脚本从 HYPERGIT_REWORD_STATE
 * 指向的 state 文件（{counter, subjects}）按调用顺序取出新 message 写入 msgfile，实现非交互 reword。
 * 用 process.execPath 运行（与扩展宿主同一 Node 二进制，规避 PATH 缺 node 的风险）。
 */
const REWORD_EDITOR_JS = `const fs = require('fs');
const target = process.argv[2];
const stateFile = process.env.HYPERGIT_REWORD_STATE;
if (!target || !stateFile) { process.exit(0); }
let state;
try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (e) { process.exit(0); }
const idx = state.counter || 0;
const subjects = state.subjects || [];
if (idx < subjects.length) {
  fs.writeFileSync(target, String(subjects[idx]) + '\\n');
  state.counter = idx + 1;
  try { fs.writeFileSync(stateFile, JSON.stringify(state)); } catch (e) {}
}
`;

/**
 * 交互式 Rebase Webview（交互式 Rebase 编辑器）。
 *
 * 展示 base..HEAD 的提交列表，每条可设 pick/reword/edit/squash/fixup/drop 动作；
 * reword 支持行内编辑新 message；行可拖拽重排序。
 * 「Start Rebase」→ serializeTodo 构造 todo → 写临时文件 → `GIT_SEQUENCE_EDITOR=cp` 注入；
 * reword 经 GIT_EDITOR=process.execPath + state 文件按序写入新 message（非交互）。
 * edit 或冲突会让 rebase 暂停 → 检测 rebase-merge 态并提示 continue/skip/abort。
 */
export class RebaseWebview {
	static async open(service: GitRepositoryService): Promise<void> {
		const repo = service.repo;
		if (!repo) {
			void vscode.window.showWarningMessage('No Git repository found');
			return;
		}
		// 选择 base
		const baseOptions = ['HEAD~5', 'HEAD~10', 'HEAD~20', 'HEAD~3', 'HEAD~2'];
		const commits = await repo.log({ maxEntries: 30 });
		const basePick = await vscode.window.showQuickPick(
			[
				...baseOptions.map((b) => ({ label: b, description: `Rebase from ${b}` })),
				...commits.slice(1).map((c) => ({ label: c.hash.slice(0, 7), description: (c.message.split('\n', 1)[0] ?? '').slice(0, 60) })),
			],
			{ placeHolder: 'Select rebase base' },
		);
		if (!basePick) {
			return;
		}
		const base = basePick.label;

		// 获取 base..HEAD 提交（逆序 → 正序：rebase 按时间正序回放）
		let rebaseCommits: RebaseCommit[];
		try {
			const out = await service.execGit(['log', '--reverse', '--format=%h|%s', `${base}..HEAD`]);
			rebaseCommits = out
				.trim()
				.split('\n')
				.filter((l) => l.trim())
				.map((l) => {
					const [hash, ...subj] = l.split('|');
					return { hash, subject: subj.join('|') };
				});
		} catch (e) {
			void vscode.window.showErrorMessage(`Failed to load commits: ${errMsg(e)}`);
			return;
		}
		if (rebaseCommits.length === 0) {
			void vscode.window.showInformationMessage(`No commits in ${base}..HEAD`);
			return;
		}

		const panel = vscode.window.createWebviewPanel('hyperGit.rebase', 'Interactive Rebase — Hyper Git', vscode.ViewColumn.Active, {
			enableScripts: true,
			retainContextWhenHidden: true,
		});
		panel.webview.html = RebaseWebview.renderHtml(rebaseCommits);

		panel.webview.onDidReceiveMessage(async (msg) => {
			if (msg.type === 'rebase') {
				await RebaseWebview.executeRebase(
					service,
					base,
					msg.actions as Array<{ hash: string; action: string; subject: string }>,
					panel,
				);
			} else if (msg.type === 'cancel') {
				panel.dispose();
			}
		});
	}

	private static async executeRebase(
		service: GitRepositoryService,
		base: string,
		actions: Array<{ hash: string; action: string; subject: string }>,
		panel: vscode.WebviewPanel,
	): Promise<void> {
		// 校验并构造 todo（按 webview DOM 顺序，即用户重排后的顺序）
		const todoItems: RebaseTodoItem[] = [];
		const rewordSubjects: string[] = [];
		for (const a of actions) {
			if (!isValidAction(a.action)) {
				void vscode.window.showErrorMessage(`Invalid action: ${a.action}`);
				return;
			}
			todoItems.push({ action: a.action, hash: a.hash, subject: a.subject });
			if (a.action === 'reword') {
				rewordSubjects.push(a.subject);
			}
		}
		const todo = serializeTodo(todoItems);

		const tag = crypto.randomBytes(4).toString('hex');
		const tmpTodo = path.join(os.tmpdir(), `hg-rebase-todo-${tag}.txt`);
		fs.writeFileSync(tmpTodo, todo);
		const env: NodeJS.ProcessEnv = { ...process.env, GIT_SEQUENCE_EDITOR: `cp ${tmpTodo}` };

		// reword：写 Node editor helper + state 文件，按 todo 顺序写入新 message
		let tmpEditor: string | undefined;
		let tmpState: string | undefined;
		if (rewordSubjects.length > 0) {
			tmpEditor = path.join(os.tmpdir(), `hg-reword-editor-${tag}.js`);
			tmpState = path.join(os.tmpdir(), `hg-reword-state-${tag}.json`);
			fs.writeFileSync(tmpEditor, REWORD_EDITOR_JS);
			fs.writeFileSync(tmpState, JSON.stringify({ counter: 0, subjects: rewordSubjects }));
			env.GIT_EDITOR = `"${process.execPath}" "${tmpEditor}"`;
			env.HYPERGIT_REWORD_STATE = tmpState;
		} else {
			env.GIT_EDITOR = ':';
		}

		try {
			await service.execGit(['rebase', '-i', base], { env });
			// rebase 可能因 edit / squash 暂停（exit 0 但 rebase-merge 仍在）：检测并提示
			const gitDir = (await service.execGit(['rev-parse', '--absolute-git-dir'])).trim();
			if (fs.existsSync(path.join(gitDir, 'rebase-merge'))) {
				void vscode.window.showWarningMessage(
					'Rebase paused (an edit or a conflict needs handling). Run in the terminal: git rebase --continue / --skip / --abort.',
				);
			} else {
				void vscode.window.showInformationMessage('Rebase complete');
				panel.dispose();
			}
		} catch (e) {
			if (!(await handleGitConflict(service, 'Rebase'))) {
				void vscode.window.showErrorMessage(`Rebase failed: ${errMsg(e)}`);
			}
		} finally {
			for (const f of [tmpTodo, tmpEditor, tmpState]) {
				if (!f) {
					continue;
				}
				try {
					fs.unlinkSync(f);
				} catch {
					/* ignore */
				}
			}
		}
	}

	private static renderHtml(commits: RebaseCommit[]): string {
		const nonce = crypto.randomBytes(16).toString('base64');
		const rows = commits
			.map(
				(c) => `<tr draggable="true" data-hash="${escapeHtml(c.hash)}">
<td class="drag" title="Drag to reorder"><svg class="grip" width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true"><circle cx="2" cy="3" r="1.3"/><circle cx="2" cy="8" r="1.3"/><circle cx="2" cy="13" r="1.3"/><circle cx="7" cy="3" r="1.3"/><circle cx="7" cy="8" r="1.3"/><circle cx="7" cy="13" r="1.3"/></svg></td>
<td><select class="action">
<option value="pick">pick</option>
<option value="reword">reword</option>
<option value="edit">edit</option>
<option value="squash">squash</option>
<option value="fixup">fixup</option>
<option value="drop">drop</option>
</select></td>
<td class="hash">${escapeHtml(c.hash.slice(0, 7))}</td>
<td><input class="subject" value="${escapeHtml(c.subject)}" disabled spellcheck="false"></td>
</tr>`,
			)
			.join('\n');
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>
${getBaseStyles()}
body { margin: 0; padding: 12px 16px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); font-size: var(--vscode-font-size); background: var(--vscode-editor-background); }
h3 { margin: 0 0 4px; font-weight: 600; }
.legend { margin: 0 0 8px; font-size: 11px; color: var(--vscode-descriptionForeground); line-height: 1.6; }
.legend code { font-family: var(--vscode-editor-font-family); color: var(--vscode-textPreformat-foreground, var(--vscode-foreground)); }
.summary { margin: 0 0 10px; font-size: 11px; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 4px 6px; border-bottom: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.2)); text-align: left; vertical-align: middle; }
th { font-weight: 600; font-size: 12px; color: var(--vscode-descriptionForeground); }
td.drag { color: var(--vscode-descriptionForeground); cursor: grab; user-select: none; width: 18px; }
td.drag .grip { display: inline-block; pointer-events: none; }
td.hash { color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); font-size: 12px; width: 70px; }
tr { background: transparent; }
tr.action-drop { opacity: 0.5; }
tr.action-drop input.subject { text-decoration: line-through; }
tr.action-squash, tr.action-fixup { background: var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,.12)); }
tr.dragging { opacity: 0.4; }
tr.drop-target { border-top: 2px solid var(--vscode-focusBorder, #007fd4); }
select, input.subject { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 2px 4px; font-size: 12px; font-family: var(--vscode-font-family); }
select { width: 92px; }
input.subject { width: 100%; }
input.subject:disabled { color: var(--vscode-descriptionForeground); opacity: 0.85; }
input.subject:not(:disabled) { border-color: var(--vscode-focusBorder, #007fd4); }
.row-actions { margin-top: 12px; display: flex; gap: 8px; justify-content: flex-end; }
.confirm-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.4); align-items: center; justify-content: center; z-index: 100; }
.confirm-box { background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); color: var(--vscode-editorWidget-foreground, var(--vscode-foreground)); border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.4)); border-radius: 6px; padding: 16px 20px; max-width: 440px; box-shadow: 0 4px 16px rgba(0,0,0,.4); }
.confirm-box .confirm-count { font-size: 13px; margin-bottom: 6px; }
.confirm-box .confirm-summary { font-family: var(--vscode-editor-font-family); font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 14px; }
.confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }
</style>
</head>
<body>
<h3>Interactive Rebase</h3>
<p class="legend"><code>reword</code> — edit the message inline &nbsp;·&nbsp; <code>edit</code>/<code>squash</code> — pauses rebase (continue in terminal) &nbsp;·&nbsp; <code>drop</code> — remove the commit &nbsp;·&nbsp; drag the handle to reorder.</p>
<div class="summary" id="summary"></div>
<table><thead><tr><th></th><th>Action</th><th>Hash</th><th>Subject</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="row-actions">
<button class="hg-btn hg-btn--secondary" id="cancel-btn">Cancel</button>
<button class="hg-btn" id="rebase-btn">Start Rebase</button>
</div>
<div class="confirm-overlay" id="confirm" role="dialog" aria-modal="true" aria-label="Confirm rebase">
  <div class="confirm-box">
    <div class="confirm-count" id="confirm-count"></div>
    <div class="confirm-summary" id="confirm-summary"></div>
    <div class="confirm-actions">
      <button class="hg-btn hg-btn--secondary" id="confirm-cancel">Cancel</button>
      <button class="hg-btn" id="confirm-go">Start Rebase</button>
    </div>
  </div>
</div>
<script nonce="${nonce}">
(function () {
  var tbody = document.querySelector('tbody');
  var rows = function () { return Array.from(tbody.querySelectorAll('tr')); };
  var confirmEl = document.getElementById('confirm');

  function updateRowStates() {
    rows().forEach(function (row) {
      var action = row.querySelector('select.action').value;
      row.classList.remove('action-pick','action-reword','action-edit','action-squash','action-fixup','action-drop');
      row.classList.add('action-' + action);
    });
  }
  function updateSummary() {
    var counts = { pick: 0, reword: 0, edit: 0, squash: 0, fixup: 0, drop: 0 };
    rows().forEach(function (row) { var a = row.querySelector('select.action').value; if (counts[a] !== undefined) counts[a] += 1; });
    var parts = [];
    Object.keys(counts).forEach(function (k) { if (counts[k]) parts.push(counts[k] + ' ' + k); });
    document.getElementById('summary').textContent = parts.length ? parts.join('  ·  ') : '';
  }

  // action 变化：仅 reword 允许编辑 subject；同步行视觉态与摘要。
  tbody.addEventListener('change', function (e) {
    if (e.target.classList.contains('action')) {
      var input = e.target.closest('tr').querySelector('input.subject');
      var isReword = e.target.value === 'reword';
      input.disabled = !isReword;
      if (isReword) { input.focus(); }
      updateRowStates();
      updateSummary();
    }
  });
  updateRowStates();
  updateSummary();

  // 拖拽重排序
  var dragged = null;
  tbody.addEventListener('dragstart', function (e) {
    if (e.target.tagName === 'TR') { dragged = e.target; e.target.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; }
  });
  tbody.addEventListener('dragend', function (e) {
    if (e.target.tagName === 'TR') { e.target.classList.remove('dragging'); }
    rows().forEach(function (r) { r.classList.remove('drop-target'); });
  });
  tbody.addEventListener('dragover', function (e) {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    var tr = e.target.closest('tr');
    rows().forEach(function (r) { r.classList.remove('drop-target'); });
    if (tr && tr !== dragged) { tr.classList.add('drop-target'); }
  });
  tbody.addEventListener('drop', function (e) {
    e.preventDefault();
    var target = e.target.closest('tr');
    if (!dragged || !target || dragged === target) { return; }
    var rect = target.getBoundingClientRect();
    var after = (e.clientY - rect.top) > rect.height / 2;
    if (after && target.nextSibling) { tbody.insertBefore(dragged, target.nextSibling); }
    else { tbody.insertBefore(dragged, target); }
  });

  function collectActions() {
    return rows().map(function (row) {
      return { hash: row.dataset.hash, action: row.querySelector('select.action').value, subject: row.querySelector('input.subject').value };
    });
  }

  // 执行前确认：rebase 改写历史，前置确认防误操作（非阻塞 HTML 覆盖层）。
  document.getElementById('rebase-btn').addEventListener('click', function () {
    var n = rows().length;
    document.getElementById('confirm-count').textContent = 'Rebase ' + n + ' commit' + (n === 1 ? '' : 's') + ' — this rewrites history.';
    document.getElementById('confirm-summary').textContent = document.getElementById('summary').textContent || (n + ' commits');
    confirmEl.style.display = 'flex';
    document.getElementById('confirm-go').focus();
  });
  document.getElementById('confirm-go').addEventListener('click', function () {
    confirmEl.style.display = 'none';
    acquireVsCodeApi().postMessage({ type: 'rebase', actions: collectActions() });
  });
  document.getElementById('confirm-cancel').addEventListener('click', function () { confirmEl.style.display = 'none'; });
  document.getElementById('cancel-btn').addEventListener('click', function () { acquireVsCodeApi().postMessage({ type: 'cancel' }); });
})();
</script>
</body>
</html>`;
	}
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
