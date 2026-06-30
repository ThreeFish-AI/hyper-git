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
		vscode.commands.registerCommand('hyperGit.stashView', async (node?: StashNode) => {
			// 只读查看 stash diff（单击叶子触发；比 apply 更安全，apply/pop/drop 仍在右键菜单）。
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const index = node?.kind === 'stash' ? node.index : 0;
			try {
				const patch = await service.execGit(['stash', 'show', '-p', '--no-color', `stash@{${index}}`]);
				if (!patch.trim()) {
					void vscode.window.showInformationMessage(`stash@{${index}} has no changes to show`);
					return;
				}
				const doc = await vscode.workspace.openTextDocument({ content: patch, language: 'diff' });
				await vscode.window.showTextDocument(doc, { preview: true });
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to show stash: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.stashCreate', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const message = await vscode.window.showInputBox({ prompt: 'Stash message (optional)', placeHolder: 'WIP' });
			try {
				await repo.createStash({ message: message && message.trim() ? message.trim() : undefined, includeUntracked: true });
				stashTree.refresh();
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to create stash: ${errMsg(e)}`);
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
				void vscode.window.showErrorMessage(`Failed to apply stash: ${errMsg(e)}`);
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
					void vscode.window.showErrorMessage(`Failed to pop stash: ${errMsg(e)}`);
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
			const choice = await vscode.window.showWarningMessage(`Drop stash@{${index}}?`, { modal: true }, 'Drop');
			if (choice === 'Drop') {
				try {
					await repo.dropStash(index);
					stashTree.refresh();
				} catch (e) {
					void vscode.window.showErrorMessage(`Failed to drop stash: ${errMsg(e)}`);
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
			const message = await vscode.window.showInputBox({ prompt: 'Stash message (keep staged changes in the working tree)', placeHolder: 'WIP' });
			try {
				const args = ['stash', 'push', '--keep-index'];
				if (message && message.trim()) {
					args.push('-m', message.trim());
				}
				await service.execGit(args);
				stashTree.refresh();
				void vscode.window.showInformationMessage('Stashed (index kept)');
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to stash: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.stashClear', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const ok = await vscode.window.showWarningMessage('Clear ALL stashes (irreversible)?', { modal: true }, 'Clear All');
			if (ok !== 'Clear All') {
				return;
			}
			try {
				await service.execGit(['stash', 'clear']);
				stashTree.refresh();
				void vscode.window.showInformationMessage('Cleared all stashes');
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to clear stashes: ${errMsg(e)}`);
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
						void vscode.window.showInformationMessage('No stashes');
						return;
					}
					const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select a stash to turn into a branch' });
					if (!pick) {
						return;
					}
					index = pick.index;
				} catch (e) {
					void vscode.window.showErrorMessage(`Failed to read stash list: ${errMsg(e)}`);
					return;
				}
			}
			const name = await vscode.window.showInputBox({ prompt: `Create and checkout a new branch from stash@{${index}}`, placeHolder: 'New branch name' });
			if (!name || !name.trim()) {
				return;
			}
			try {
				await service.execGit(['stash', 'branch', name.trim(), `stash@{${index}}`]);
				stashTree.refresh();
				void vscode.window.showInformationMessage(`Created branch ${name.trim()} from stash@{${index}}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to create branch: ${errMsg(e)}`);
			}
		}),
	);

	return subs;
}
