import * as vscode from 'vscode';
import type { GitRepositoryService } from './git-repository-service';
import type { WorktreeNode, WorktreeTreeProvider } from './tree/worktree-tree';
import { parseWorktreeList } from '../engine/worktree/worktree-list';

/**
 * 注册 Worktree 相关命令。
 *
 * 经受控 CLI 通道 `service.execGit` 执行 `git worktree` 全生命周期操作（vscode.git 稳定 API 未暴露）。
 * 范式对齐 stash-commands：命令参数类型守卫 + try/catch + showErrorMessage + 成功后 refresh；
 * 危险/不可逆操作经 `showWarningMessage({ modal: true })` 二次确认。
 */
export function registerWorktreeCommands(service: GitRepositoryService, worktreeTree: WorktreeTreeProvider): vscode.Disposable[] {
	const subs: vscode.Disposable[] = [];
	const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

	subs.push(
		vscode.commands.registerCommand('hyperGit.worktreeRefresh', () => {
			worktreeTree.refresh();
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.worktreeAdd', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			// ① 分支模式
			const modePick = await vscode.window.showQuickPick(
				[
					{ label: 'New branch', description: 'Create a new branch and check it out', mode: 'new' as const },
					{ label: 'Checkout existing branch', description: 'Check out an existing local branch', mode: 'checkout' as const },
					{ label: 'Detached HEAD', description: 'Check out a commit/branch in detached state', mode: 'detached' as const },
				],
				{ placeHolder: 'Worktree branch mode' },
			);
			if (!modePick) {
				return;
			}

			// ② 收集分支名 / 源 ref
			let branch: string | undefined;
			let sourceRef: string | undefined;
			if (modePick.mode === 'new') {
				branch = await vscode.window.showInputBox({ prompt: 'New branch name', placeHolder: 'feature/y' });
				if (!branch?.trim()) {
					return;
				}
				const start = await vscode.window.showInputBox({ prompt: 'Start point (leave empty = HEAD)', placeHolder: 'HEAD / main / abc1234' });
				if (start === undefined) {
					return; // Esc 取消；空字符串 = HEAD（允许）
				}
				sourceRef = start.trim() || undefined;
			} else {
				// checkout / detached：枚举本地分支供选择
				let items: { label: string }[] = [];
				try {
					const list = await service.execGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
					items = list
						.split('\n')
						.map((l) => l.trim())
						.filter((l) => l.length > 0)
						.map((l) => ({ label: l }));
				} catch {
					// 列表读取失败 → 退化为空列表（下方 pick 为空时取消）
				}
				const pick = await vscode.window.showQuickPick(items, {
					placeHolder: modePick.mode === 'detached' ? 'Select commit/branch (detached)' : 'Select a local branch',
				});
				if (!pick) {
					return;
				}
				sourceRef = pick.label;
			}

			// ③ Worktree 路径
			const safeName = (branch ?? sourceRef ?? 'worktree').replace(/[^A-Za-z0-9._-]+/g, '-');
			const wtPath = await vscode.window.showInputBox({
				prompt: 'Worktree path (relative to repo root / absolute)',
				value: `../${safeName}-wt`,
				placeHolder: '../feature-y-wt',
			});
			if (!wtPath?.trim()) {
				return;
			}

			const args = ['worktree', 'add'];
			if (modePick.mode === 'new') {
				args.push('-b', branch!.trim());
			} else if (modePick.mode === 'detached') {
				args.push('--detach');
			}
			args.push(wtPath.trim());
			if (modePick.mode === 'new') {
				if (sourceRef) {
					args.push(sourceRef); // 可选 start-point（默认 HEAD）
				}
			} else {
				args.push(sourceRef!); // checkout / detached 必须有源 ref
			}
			try {
				await service.execGit(args);
				worktreeTree.refresh();
				void vscode.window.showInformationMessage(`Worktree created: ${wtPath.trim()}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to create Worktree: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.worktreeOpen', async (node?: WorktreeNode) => {
			if (!node || node.kind !== 'worktree') {
				return;
			}
			// 默认新窗口打开：本项目单仓库选取模式（pickRepository 只取首个），多根同窗会破坏
			// SCM/分支/日志数据源；独立窗口符合 worktree 并行工作语义。
			await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(node.path), { forceNewWindow: true });
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.worktreeRemove', async (node?: WorktreeNode) => {
			const repo = service.repo;
			if (!repo || !node || node.kind !== 'worktree') {
				return;
			}
			if (node.isMain) {
				void vscode.window.showWarningMessage('The main worktree cannot be deleted');
				return;
			}
			if (worktreeTree.isCurrent(node)) {
				void vscode.window.showWarningMessage('The currently open Worktree cannot be deleted; please switch to another window first');
				return;
			}
			const forcePick = await vscode.window.showQuickPick(
				[
					{ label: 'Delete', description: 'Fails if there are uncommitted changes', f: false as const },
					{ label: 'Force delete', description: 'Ignore uncommitted changes (irreversible)', f: true as const },
				],
				{ placeHolder: 'Delete Worktree' },
			);
			if (!forcePick) {
				return;
			}
			const ok = await vscode.window.showWarningMessage(
				`Delete Worktree?\n${node.path}\n(${node.ref})`,
				{ modal: true },
				'Delete',
			);
			if (ok !== 'Delete') {
				return;
			}
			try {
				const args = ['worktree', 'remove'];
				if (forcePick.f) {
					args.push('--force');
				}
				args.push(node.path);
				await service.execGit(args);
				worktreeTree.refresh();
				void vscode.window.showInformationMessage(`Worktree deleted: ${node.name}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to delete Worktree: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.worktreeCopyPath', async (node?: WorktreeNode) => {
			if (!node || node.kind !== 'worktree') {
				return;
			}
			await vscode.env.clipboard.writeText(node.path);
			void vscode.window.showInformationMessage('Worktree path copied');
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.worktreeLock', async (node?: WorktreeNode) => {
			const repo = service.repo;
			if (!repo || !node || node.kind !== 'worktree') {
				return;
			}
			const reason = await vscode.window.showInputBox({ prompt: 'Lock reason (optional)', placeHolder: 'Backing up' });
			if (reason === undefined) {
				return; // Esc 取消；空字符串 = 无原因（允许）
			}
			try {
				const args = ['worktree', 'lock'];
				if (reason.trim()) {
					args.push('--reason', reason.trim());
				}
				args.push(node.path);
				await service.execGit(args);
				worktreeTree.refresh();
				void vscode.window.showInformationMessage(`Worktree locked: ${node.name}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to lock Worktree: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.worktreeUnlock', async (node?: WorktreeNode) => {
			const repo = service.repo;
			if (!repo || !node || node.kind !== 'worktree') {
				return;
			}
			try {
				await service.execGit(['worktree', 'unlock', node.path]);
				worktreeTree.refresh();
				void vscode.window.showInformationMessage(`Worktree unlocked: ${node.name}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to unlock Worktree: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.worktreeMove', async (node?: WorktreeNode) => {
			const repo = service.repo;
			if (!repo || !node || node.kind !== 'worktree') {
				return;
			}
			if (node.isMain) {
				void vscode.window.showWarningMessage('The main worktree cannot be moved');
				return;
			}
			const dest = await vscode.window.showInputBox({
				prompt: 'New path (relative to repo root / absolute)',
				placeHolder: '../new-location',
			});
			if (!dest?.trim()) {
				return;
			}
			try {
				await service.execGit(['worktree', 'move', node.path, dest.trim()]);
				worktreeTree.refresh();
				void vscode.window.showInformationMessage(`Worktree moved → ${dest.trim()}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to move Worktree: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.worktreePrune', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			// 不静默清理：先列出 prunable 项，无则提示；有则 modal 确认（防误删网络/移动盘合法 worktree）。
			let prunablePaths: string[] = [];
			try {
				const out = await service.execGit(['worktree', 'list', '--porcelain', '-z']);
				prunablePaths = parseWorktreeList(out)
					.filter((p) => p.prunable)
					.map((p) => p.path);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to read Worktree list: ${errMsg(e)}`);
				return;
			}
			if (prunablePaths.length === 0) {
				void vscode.window.showInformationMessage('No stale Worktrees to prune');
				return;
			}
			const ok = await vscode.window.showWarningMessage(
				`Prune metadata for ${prunablePaths.length} stale Worktree(s)?\n${prunablePaths.join('\n')}`,
				{ modal: true },
				'Prune',
			);
			if (ok !== 'Prune') {
				return;
			}
			try {
				await service.execGit(['worktree', 'prune', '-v']);
				worktreeTree.refresh();
				void vscode.window.showInformationMessage(`Pruned ${prunablePaths.length} stale Worktree(s)`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to prune Worktrees: ${errMsg(e)}`);
			}
		}),
	);

	return subs;
}
