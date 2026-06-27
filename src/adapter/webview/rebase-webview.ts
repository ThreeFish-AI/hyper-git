import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { GitRepositoryService } from '../git-repository-service';

interface RebaseCommit {
	readonly hash: string;
	readonly subject: string;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * 交互式 Rebase Webview（IDEA Git Log → rebase 等价）。
 *
 * 展示 base..HEAD 的提交列表，每条可设 pick/squash/fixup/drop 动作。
 * 「Start Rebase」→ 构造 todo 序列 → 写临时文件 → `GIT_SEQUENCE_EDITOR=cp <tempfile>` 非交互触发 rebase。
 * 重排序（drag/drop）作为后续增强；当前覆盖 squash/fixup/drop（最常见场景）。
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

		// 获取 base..HEAD 提交（逆序 → 正序）
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

		const panel = vscode.window.createWebviewPanel('hyperGit.rebase', 'Interactive Rebase — Hyper Git', vscode.ViewColumn.Active, { enableScripts: true });
		panel.webview.html = RebaseWebview.renderHtml(rebaseCommits);

		panel.webview.onDidReceiveMessage(async (msg) => {
			if (msg.type === 'rebase') {
				await RebaseWebview.executeRebase(service, base, msg.actions as Array<{ hash: string; action: string; subject: string }>, panel);
			}
		});
	}

	private static async executeRebase(service: GitRepositoryService, base: string, actions: Array<{ hash: string; action: string; subject: string }>, panel: vscode.WebviewPanel): Promise<void> {
		const todo = actions.map((a) => `${a.action} ${a.hash} ${a.subject}`).join('\n') + '\n';
		const tmpTodo = path.join(os.tmpdir(), `hg-rebase-todo-${crypto.randomBytes(4).toString('hex')}.txt`);
		fs.writeFileSync(tmpTodo, todo);
		try {
			await service.execGit(['rebase', '-i', base], {
				env: { ...process.env, GIT_SEQUENCE_EDITOR: `cp ${tmpTodo}`, GIT_EDITOR: ':' },
			});
			void vscode.window.showInformationMessage('Rebase 完成');
			panel.dispose();
		} catch (e) {
			void vscode.window.showErrorMessage(`Rebase 失败（可能需手动解冲突）：${errMsg(e)}`);
		} finally {
			try {
				fs.unlinkSync(tmpTodo);
			} catch {
				/* ignore */
			}
		}
	}

	private static renderHtml(commits: RebaseCommit[]): string {
		const nonce = crypto.randomBytes(16).toString('base64');
		const rows = commits
			.map(
				(c, i) => `<tr data-hash="${c.hash}" data-subject="${escapeHtml(c.subject)}">
<td><select class="action" data-index="${i}">
<option value="pick">pick</option>
<option value="squash">squash</option>
<option value="fixup">fixup</option>
<option value="drop">drop</option>
</select></td>
<td class="hash">${c.hash.slice(0, 7)}</td>
<td class="subject">${escapeHtml(c.subject)}</td>
</tr>`,
			)
			.join('\n');
		return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>
body { margin: 0; padding: 12px 16px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); font-size: var(--vscode-font-size); background: var(--vscode-editor-background); }
h3 { margin: 0 0 8px; font-weight: 600; }
table { width: 100%; border-collapse: collapse; }
td { padding: 4px 6px; border-bottom: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,.2)); }
td.hash { color: var(--vscode-editorWarning-foreground, #d29922); font-family: var(--vscode-editor-font-family); font-size: 12px; }
td.subject { max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border, transparent); padding: 2px 4px; font-size: 12px; }
button { margin-top: 12px; padding: 6px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 2px; cursor: pointer; font-size: 13px; }
button:hover { opacity: 0.9; }
</style>
</head>
<body>
<h3>Interactive Rebase</h3>
<table><thead><tr><th>Action</th><th>Hash</th><th>Subject</th></tr></thead>
<tbody>${rows}</tbody></table>
<button id="rebase-btn">Start Rebase</button>
<script nonce="${nonce}">
document.getElementById('rebase-btn').addEventListener('click', function() {
  var rows = document.querySelectorAll('tbody tr');
  var actions = [];
  rows.forEach(function(row) {
    var select = row.querySelector('.action');
    actions.push({ hash: row.dataset.hash, action: select.value, subject: row.dataset.subject });
  });
  var vscode = acquireVsCodeApi();
  vscode.postMessage({ type: 'rebase', actions: actions });
});
</script>
</body>
</html>`;
	}
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
