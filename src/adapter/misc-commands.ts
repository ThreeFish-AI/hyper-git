import * as fs from 'fs';
import * as vscode from 'vscode';
import type { GitRepositoryService } from './git-repository-service';
import type { LogFilterControl } from './webview/log-webview';
import type { BranchesTreeProvider } from './tree/branches-tree';
import { handleGitConflict } from './conflict-ui';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * 杂项 git 操作（Phase 5）：Create/Apply Patch、Reflog 视图。
 *
 * - Create Patch：将工作区或已暂存改动导出为 .patch 文件（git diff [--cached]）。
 * - Apply Patch：选择 .patch 文件应用到工作区（git apply）。
 * - Show Reflog：git reflog 渲染为只读文档（等价于 Git Reflog 查看）。
 */
export function registerMiscCommands(
	service: GitRepositoryService,
	branchesTree: BranchesTreeProvider,
	logTree: LogFilterControl,
): vscode.Disposable[] {
	const subs: vscode.Disposable[] = [];

	subs.push(
		vscode.commands.registerCommand('hyperGit.createPatch', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const scope = await vscode.window.showQuickPick(
				[
					{ label: 'Unstaged changes', args: ['diff'] },
					{ label: 'Staged changes', args: ['diff', '--cached'] },
					{ label: 'All changes (HEAD ↔ Working tree)', args: ['diff', 'HEAD'] },
				],
				{ placeHolder: 'Which changes to export as patch' },
			);
			if (!scope) {
				return;
			}
			let patch = '';
			try {
				patch = await service.execGit(scope.args);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to generate patch: ${errMsg(e)}`);
				return;
			}
			if (!patch.trim()) {
				void vscode.window.showInformationMessage('No changes to export');
				return;
			}
			const target = await vscode.window.showSaveDialog({
				defaultUri: vscode.Uri.joinPath(repo.rootUri, 'changes.patch'),
				filters: { Patch: ['patch', 'diff'] },
			});
			if (!target) {
				return;
			}
			try {
				await fs.promises.writeFile(target.fsPath, patch, 'utf8');
				void vscode.window.showInformationMessage(`Patch exported: ${target.fsPath}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to write patch: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.applyPatch', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const sel = await vscode.window.showOpenDialog({
				canSelectMany: false,
				filters: { Patch: ['patch', 'diff'], All: ['*'] },
				title: 'Select a patch file to apply',
			});
			if (!sel?.[0]) {
				return;
			}
			const mode = await vscode.window.showQuickPick(
				[
					{ label: 'Apply to working tree', args: [] as string[] },
					{ label: 'Apply and stage (--index)', args: ['--index'] },
					{ label: '3-way apply (resolves conflicts)', args: ['--3way'] },
				],
				{ placeHolder: 'Apply mode' },
			);
			if (!mode) {
				return;
			}
			try {
				await service.execGit(['apply', ...mode.args, sel[0].fsPath]);
				branchesTree.refresh();
				logTree.refresh();
				void vscode.window.showInformationMessage('Patch applied');
			} catch (e) {
				if (!(await handleGitConflict(service, 'Apply Patch'))) {
					void vscode.window.showErrorMessage(`Failed to apply patch: ${errMsg(e)}`);
				}
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.showReflog', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			try {
				const out = await service.execGit(['reflog', '-n', '200', '--date=relative']);
				const doc = await vscode.workspace.openTextDocument({ content: `# git reflog (latest 200 entries)\n\n${out}`, language: 'plaintext' });
				await vscode.window.showTextDocument(doc, { preview: true });
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to read reflog: ${errMsg(e)}`);
			}
		}),
	);

	return subs;
}
