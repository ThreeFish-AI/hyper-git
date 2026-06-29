import * as vscode from 'vscode';
import type { GitRepositoryService } from './git-repository-service';
import type { StashNode, StashTreeProvider } from './tree/stash-tree';
import { handleGitConflict } from './conflict-ui';

/**
 * 注册 Stash 相关命令（M4）。
 *
 * 经 vscode.git 稳定 API：createStash / applyStash / popStash / dropStash。
 * stash 列表由 `StashTreeProvider`（execGit `git stash list`）枚举，apply/pop/drop 按 stash@{n} 真实索引。
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
			const index = node?.kind === 'stash' ? node.index : 0;
			try {
				await repo.applyStash(index);
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
			const index = node?.kind === 'stash' ? node.index : 0;
			try {
				await repo.popStash(index);
				stashTree.refresh();
			} catch (e) {
				if (!(await handleGitConflict(service, 'Stash pop'))) {
					void vscode.window.showErrorMessage(`Stash pop 失败：${errMsg(e)}`);
				}
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.stashDrop', async (node?: StashNode) => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const index = node?.kind === 'stash' ? node.index : 0;
			const choice = await vscode.window.showWarningMessage(`删除 stash@{${index}}？`, { modal: true }, '删除');
			if (choice === '删除') {
				try {
					await repo.dropStash(index);
					stashTree.refresh();
				} catch (e) {
					void vscode.window.showErrorMessage(`Stash 删除失败：${errMsg(e)}`);
				}
			}
		}),
	);

	// —— Stash 高级（Phase 4）：keep-index / clear / unstash-as-branch ——

	subs.push(
		vscode.commands.registerCommand('hyperGit.stashKeepIndex', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const message = await vscode.window.showInputBox({ prompt: 'Stash 信息（保留已暂存改动在工作区）', placeHolder: 'WIP' });
			try {
				const args = ['stash', 'push', '--keep-index'];
				if (message && message.trim()) {
					args.push('-m', message.trim());
				}
				await service.execGit(args);
				stashTree.refresh();
				void vscode.window.showInformationMessage('已 Stash（保留已暂存）');
			} catch (e) {
				void vscode.window.showErrorMessage(`Stash 失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.stashClear', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const ok = await vscode.window.showWarningMessage('清空所有 stash（不可撤销）？', { modal: true }, '清空');
			if (ok !== '清空') {
				return;
			}
			try {
				await service.execGit(['stash', 'clear']);
				stashTree.refresh();
				void vscode.window.showInformationMessage('已清空所有 stash');
			} catch (e) {
				void vscode.window.showErrorMessage(`清空失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.stashBranch', async (node?: StashNode) => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			let index = node?.kind === 'stash' ? node.index : 0;
			// 无节点时从 stash 列表选择
			if (!node) {
				try {
					const list = await service.execGit(['stash', 'list']);
					const items = list
						.split('\n')
						.filter((l) => l.trim())
						.map((l) => {
							const m = l.match(/^stash@\{(\d+)\}:\s*(.*)$/);
							return m ? { label: `stash@{${m[1]}}`, description: m[2], index: Number(m[1]) } : null;
						})
						.filter((x): x is { label: string; description: string; index: number } => x !== null);
					if (items.length === 0) {
						void vscode.window.showInformationMessage('无 stash');
						return;
					}
					const pick = await vscode.window.showQuickPick(items, { placeHolder: '选择要转为分支的 stash' });
					if (!pick) {
						return;
					}
					index = pick.index;
				} catch (e) {
					void vscode.window.showErrorMessage(`读取 stash 列表失败：${errMsg(e)}`);
					return;
				}
			}
			const name = await vscode.window.showInputBox({ prompt: `从 stash@{${index}} 创建并检出新分支`, placeHolder: '新分支名' });
			if (!name || !name.trim()) {
				return;
			}
			try {
				await service.execGit(['stash', 'branch', name.trim(), `stash@{${index}}`]);
				stashTree.refresh();
				void vscode.window.showInformationMessage(`已从 stash@{${index}} 创建分支 ${name.trim()}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`创建分支失败：${errMsg(e)}`);
			}
		}),
	);

	return subs;
}
