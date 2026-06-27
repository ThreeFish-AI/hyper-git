import * as vscode from 'vscode';
import type { GitRepositoryService } from './git-repository-service';
import type { StashNode, StashTreeProvider } from './tree/stash-tree';

/**
 * 注册 Stash 相关命令（M4）。
 *
 * 经 vscode.git 稳定 API：createStash / applyStash / popStash / dropStash。
 * 「Shelve Changes」以 stash 近似（MVP，见工程方案 §4 P2）；忠实 patch Shelf 受 API 限制延后。
 */
export function registerStashCommands(service: GitRepositoryService, stashTree: StashTreeProvider): vscode.Disposable[] {
	const subs: vscode.Disposable[] = [];
	const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

	subs.push(
		vscode.commands.registerCommand('hyperGit.stashCreate', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const message = await vscode.window.showInputBox({ prompt: 'Stash 信息（可空）', placeHolder: 'WIP' });
			try {
				await repo.createStash({ message: message && message.trim() ? message.trim() : undefined, includeUntracked: true });
				stashTree.refresh();
			} catch (e) {
				void vscode.window.showErrorMessage(`Stash 创建失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.stashApply', async (node?: StashNode) => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			try {
				await repo.applyStash(node?.kind === 'stash' ? node.index : 0);
				stashTree.refresh();
			} catch (e) {
				void vscode.window.showErrorMessage(`Stash 应用失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.stashPop', async (node?: StashNode) => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			try {
				await repo.popStash(node?.kind === 'stash' ? node.index : 0);
				stashTree.refresh();
			} catch (e) {
				void vscode.window.showErrorMessage(`Stash pop 失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.stashDrop', async (node?: StashNode) => {
			const repo = service.repo;
			if (!repo || node?.kind !== 'stash') {
				return;
			}
			const choice = await vscode.window.showWarningMessage(`删除 stash@{${node.index}}？`, { modal: true }, '删除');
			if (choice === '删除') {
				try {
					await repo.dropStash(node.index);
					stashTree.refresh();
				} catch (e) {
					void vscode.window.showErrorMessage(`Stash 删除失败：${errMsg(e)}`);
				}
			}
		}),
	);

	return subs;
}
