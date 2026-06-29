import * as fs from 'fs';
import * as vscode from 'vscode';
import type { GitRepositoryService } from './git-repository-service';
import type { LogTreeProvider } from './tree/log-tree';
import type { BranchesTreeProvider } from './tree/branches-tree';
import { handleGitConflict } from './conflict-ui';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * 杂项 git 操作（Phase 5）：Create/Apply Patch、Reflog 视图。
 *
 * - Create Patch：将工作区或已暂存改动导出为 .patch 文件（git diff [--cached]）。
 * - Apply Patch：选择 .patch 文件应用到工作区（git apply）。
 * - Show Reflog：git reflog 渲染为只读文档（IDEA Git → Show Reflog 等价）。
 */
export function registerMiscCommands(
	service: GitRepositoryService,
	branchesTree: BranchesTreeProvider,
	logTree: LogTreeProvider,
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
					{ label: '未暂存改动', args: ['diff'] },
					{ label: '已暂存改动', args: ['diff', '--cached'] },
					{ label: '全部改动（HEAD↔工作区）', args: ['diff', 'HEAD'] },
				],
				{ placeHolder: '导出哪部分改动为 patch' },
			);
			if (!scope) {
				return;
			}
			let patch: string;
			try {
				patch = await service.execGit(scope.args);
			} catch (e) {
				void vscode.window.showErrorMessage(`生成 patch 失败：${errMsg(e)}`);
				return;
			}
			if (!patch.trim()) {
				void vscode.window.showInformationMessage('无改动可导出');
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
				void vscode.window.showInformationMessage(`已导出 patch：${target.fsPath}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`写入 patch 失败：${errMsg(e)}`);
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
				title: '选择要应用的 patch 文件',
			});
			if (!sel?.[0]) {
				return;
			}
			const mode = await vscode.window.showQuickPick(
				[
					{ label: '应用到工作区', args: [] as string[] },
					{ label: '应用并暂存（--index）', args: ['--index'] },
					{ label: '3-way 应用（冲突可解）', args: ['--3way'] },
				],
				{ placeHolder: 'Apply 模式' },
			);
			if (!mode) {
				return;
			}
			try {
				await service.execGit(['apply', ...mode.args, sel[0].fsPath]);
				branchesTree.refresh();
				logTree.refresh();
				void vscode.window.showInformationMessage('已应用 patch');
			} catch (e) {
				if (!(await handleGitConflict(service, 'Apply Patch'))) {
					void vscode.window.showErrorMessage(`应用 patch 失败：${errMsg(e)}`);
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
				const doc = await vscode.workspace.openTextDocument({ content: `# git reflog（最近 200 条）\n\n${out}`, language: 'plaintext' });
				await vscode.window.showTextDocument(doc, { preview: true });
			} catch (e) {
				void vscode.window.showErrorMessage(`读取 reflog 失败：${errMsg(e)}`);
			}
		}),
	);

	return subs;
}
