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
			void vscode.window.showWarningMessage('未找到 Git 仓库');
			return;
		}
		// 选择 base
		const baseOptions = ['HEAD~5', 'HEAD~10', 'HEAD~20', 'HEAD~3', 'HEAD~2'];
		const commits = await repo.log({ maxEntries: 30 });
		const basePick = await vscode.window.showQuickPick(
			[
				...baseOptions.map((b) => ({ label: b, description: `从 ${b} 开始 rebase` })),
				...commits.slice(1).map((c) => ({ label: c.hash.slice(0, 7), description: (c.message.split('\n', 1)[0] ?? '').slice(0, 60) })),
			],
			{ placeHolder: '选择 rebase 起点（base）' },
		);
		if (!basePick) {
			return;
		}
		const base = basePick.label;

		// 获取 base..HEAD 提交（逆序 → 正序：rebase 按时间正序回放）
		let rebaseCommits: RebaseCommit[] = [];
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
			void vscode.window.showErrorMessage(`获取提交列表失败：${errMsg(e)}`);
			return;
		}
		if (rebaseCommits.length === 0) {
			void vscode.window.showInformationMessage(`${base}..HEAD 无提交`);
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
				void vscode.window.showErrorMessage(`非法动作：${a.action}`);
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
					'Rebase 已暂停（遇到 edit 或需处理）。请在终端运行：git rebase --continue / --skip / --abort。',
				);
			} else {
				void vscode.window.showInformationMessage('Rebase 完成');
				panel.dispose();
			}
		} catch (e) {
			if (!(await handleGitConflict(service, 'Rebase'))) {
				void vscode.window.showErrorMessage(`Rebase 失败：${errMsg(e)}`);
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
<td class="drag" title="拖拽以重排序">⠿</td>
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
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>
${getBaseStyles()}
body { margin: 0; padding: 12px 16px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); font-size: var(--vscode-font-size); background: var(--vscode-editor-background); }
h3 { margin: 0 0 4px; font-weight: 600; }
.hint { margin: 0 0 10px; font-size: 12px; color: var(--vscode-descriptionForeground); }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 4px 6px; border-bottom: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.2)); text-align: left; }
th { font-weight: 600; font-size: 12px; color: var(--vscode-descriptionForeground); }
td.drag { color: var(--vscode-descriptionForeground); cursor: grab; user-select: none; width: 18px; }
td.hash { color: var(--vscode-editorWarning-foreground, #d29922); font-family: var(--vscode-editor-font-family); font-size: 12px; width: 70px; }
tr { background: transparent; }
tr.dragging { opacity: 0.4; }
tr.drop-target { border-top: 2px solid var(--vscode-focusBorder, #007fd4); }
select, input.subject { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 2px 4px; font-size: 12px; font-family: var(--vscode-font-family); }
select { width: 80px; }
input.subject { width: 100%; }
input.subject:disabled { color: var(--vscode-descriptionForeground); opacity: 0.85; }
input.subject:not(:disabled) { border-color: var(--vscode-focusBorder, #007fd4); }
.row-actions { margin-top: 12px; }
</style>
</head>
<body>
<h3>Interactive Rebase</h3>
<p class="hint">拖拽 ⠿ 重排序 · 选 reword 可行内编辑 message · edit/squash 会暂停（终端 continue） · drop 删除提交</p>
<table><thead><tr><th></th><th>Action</th><th>Hash</th><th>Subject</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="row-actions">
<button class="hg-btn" id="rebase-btn">Start Rebase</button>
</div>
<script nonce="${nonce}">
(function () {
  var tbody = document.querySelector('tbody');
  var rows = function () { return Array.from(tbody.querySelectorAll('tr')); };

  // action 变化：仅 reword 允许编辑 subject
  tbody.addEventListener('change', function (e) {
    if (e.target.classList.contains('action')) {
      var input = e.target.closest('tr').querySelector('input.subject');
      var isReword = e.target.value === 'reword';
      input.disabled = !isReword;
      if (isReword) { input.focus(); }
    }
  });

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

  // 提交：按 DOM 顺序收集
  document.getElementById('rebase-btn').addEventListener('click', function () {
    var actions = rows().map(function (row) {
      return {
        hash: row.dataset.hash,
        action: row.querySelector('select.action').value,
        subject: row.querySelector('input.subject').value,
      };
    });
    acquireVsCodeApi().postMessage({ type: 'rebase', actions: actions });
  });
})();
</script>
</body>
</html>`;
	}
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
