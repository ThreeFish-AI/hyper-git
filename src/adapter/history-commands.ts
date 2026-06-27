import * as path from 'path';
import * as vscode from 'vscode';
import type { BranchNode } from './tree/branches-tree';
import type { BranchesTreeProvider } from './tree/branches-tree';
import type { ChangeItem, GitRepositoryService } from './git-repository-service';
import type { LogNode, LogTreeProvider } from './tree/log-tree';

/** 注册 Log/Branches/Blame/History 相关命令（M3）。 */
export function registerHistoryCommands(
	service: GitRepositoryService,
	logTree: LogTreeProvider,
	branchesTree: BranchesTreeProvider,
): vscode.Disposable[] {
	const subs: vscode.Disposable[] = [];
	const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

	subs.push(vscode.commands.registerCommand('hyperGit.refreshLog', () => logTree.refresh()));
	subs.push(vscode.commands.registerCommand('hyperGit.refreshBranches', () => branchesTree.refresh()));

	subs.push(
		vscode.commands.registerCommand('hyperGit.logFilterAuthor', async () => {
			const author = await vscode.window.showInputBox({ prompt: '按作者过滤（Author）', placeHolder: '例如 John' });
			const f = logTree.getFilter();
			logTree.setFilter({ ...f, author: author && author.trim() ? author.trim() : undefined });
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.logFilterPath', async () => {
			const uri = await vscode.window.showOpenDialog({ canSelectMany: false });
			const repo = service.repo;
			if (uri?.[0] && repo) {
				const rel = path.relative(repo.rootUri.fsPath, uri[0].fsPath).split(path.sep).join('/');
				const f = logTree.getFilter();
				logTree.setFilter({ ...f, path: rel });
			}
		}),
	);

	subs.push(vscode.commands.registerCommand('hyperGit.logClearFilter', () => logTree.clearFilter()));

	subs.push(
		vscode.commands.registerCommand('hyperGit.copyCommitHash', (node: LogNode) => {
			if (node?.kind === 'commit') {
				void vscode.env.clipboard.writeText(node.commit.hash);
				void vscode.window.showInformationMessage(`已复制 ${node.commit.hash.slice(0, 7)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.showHistory', async (change?: ChangeItem) => {
			if (change?.relativePath) {
				logTree.setFilter({ path: change.relativePath });
			}
			await vscode.commands.executeCommand('hyperGit.log.focus');
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.branchCreate', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const name = await vscode.window.showInputBox({ prompt: '新分支名称' });
			if (name && name.trim()) {
				try {
					await repo.createBranch(name.trim(), true);
					branchesTree.refresh();
				} catch (e) {
					void vscode.window.showErrorMessage(`创建分支失败：${errMsg(e)}`);
				}
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.branchCheckout', async (node: BranchNode) => {
			const repo = service.repo;
			if (!repo || node?.kind !== 'branch') {
				return;
			}
			try {
				await repo.checkout(node.ref.name ?? '');
				branchesTree.refresh();
			} catch (e) {
				void vscode.window.showErrorMessage(`检出失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.branchDelete', async (node: BranchNode) => {
			const repo = service.repo;
			if (!repo || node?.kind !== 'branch' || node.remote) {
				return;
			}
			const name = node.ref.name ?? '';
			const choice = await vscode.window.showWarningMessage(`删除分支「${name}」？`, { modal: true }, '删除');
			if (choice === '删除') {
				try {
					await repo.deleteBranch(name, true);
					branchesTree.refresh();
				} catch (e) {
					void vscode.window.showErrorMessage(`删除失败：${errMsg(e)}`);
				}
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.mergeBranch', async (node: BranchNode) => {
			const repo = service.repo;
			if (!repo || node?.kind !== 'branch') {
				return;
			}
			try {
				await repo.merge(node.ref.name ?? '');
				branchesTree.refresh();
			} catch (e) {
				void vscode.window.showErrorMessage(`合并失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.rebaseBranch', async (node: BranchNode) => {
			const repo = service.repo;
			if (!repo || node?.kind !== 'branch') {
				return;
			}
			try {
				await repo.rebase(node.ref.name ?? '');
				branchesTree.refresh();
			} catch (e) {
				void vscode.window.showErrorMessage(`变基失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.showBlame', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				void vscode.window.showWarningMessage('请先打开一个文件');
				return;
			}
			const rel = path.relative(repo.rootUri.fsPath, editor.document.uri.fsPath).split(path.sep).join('/');
			try {
				const blame = await repo.blame(rel);
				const doc = await vscode.workspace.openTextDocument({ content: blame, language: 'plaintext' });
				await vscode.window.showTextDocument(doc, { preview: true });
			} catch (e) {
				void vscode.window.showErrorMessage(`Blame 失败：${errMsg(e)}`);
			}
		}),
	);

	return subs;
}
