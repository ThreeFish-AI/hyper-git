import * as vscode from 'vscode';
import { selectedBranchRefs } from './branch-selection';
import { handleGitConflict } from './conflict-ui';
import type { BranchNode, BranchesTreeProvider } from './tree/branches-tree';
import type { LogFilterControl } from './webview/log-webview';
import { truncateNames } from '../engine/ref/cleanup';
import {
	formatRemoteDeleteConfirm,
	partitionRemoteByProtected,
	resolveRemoteBranch,
	type RemoteBranchTarget,
} from '../engine/ref/remote-ref';
import type { GitRepositoryService } from './git-repository-service';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * 注册远程同步对话框（Phase 3）：Push 对话框 / Update Project / Merge 对话框。
 *
 * vscode.git 稳定 API 的 pull/push 缺策略/force/tags 选项，故经 execGit 实现：
 * - Push：force/force-with-lease/push tags（核心走 repo.push，tags 走 CLI）。
 * - Update Project：pull --rebase / --no-rebase（策略）。
 * - Merge：--ff-only / --no-ff / --squash + 自定义 message。
 */
export function registerRemoteCommands(
	service: GitRepositoryService,
	branchesTree: BranchesTreeProvider,
	logTree: LogFilterControl,
): vscode.Disposable[] {
	const subs: vscode.Disposable[] = [];

	subs.push(
		vscode.commands.registerCommand('hyperGit.pushDialog', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const remotes = repo.state.remotes.map((r) => r.name);
			if (remotes.length === 0) {
				void vscode.window.showWarningMessage('No remote repository configured');
				return;
			}
			// 待推送提交预览（best-effort，无 upstream 时忽略）
			let previewCount = '';
			try {
				const out = (await service.execGit(['log', '@{u}..HEAD', '--oneline'])).trim();
				if (out) {
					previewCount = ` (${out.split('\n').length} commit(s) to push)`;
				}
			} catch {
				/* 无上游，忽略 */
			}
			const remote = await vscode.window.showQuickPick(remotes, { placeHolder: `Select target remote ${previewCount}` });
			if (!remote) {
				return;
			}
			const mode = await vscode.window.showQuickPick(
				[
					{ label: 'Normal', description: 'Normal push', force: undefined as 0 | 1 | undefined },
					{ label: 'Force-with-lease', description: 'Safe force push (recommended)', force: 1 as const },
					{ label: 'Force', description: '⚠ Force overwrite remote (dangerous)', force: 0 as const },
				],
				{ placeHolder: 'Push mode' },
			);
			if (!mode) {
				return;
			}
			const tags = await vscode.window.showQuickPick(['No', 'Yes'], { placeHolder: 'Push tags as well?' });
			if (!tags) {
				return;
			}
			try {
				await repo.push(remote, undefined, false, mode.force);
				if (tags === 'Yes') {
					await service.execGit(['push', remote, '--tags']);
				}
				branchesTree.refresh();
				logTree.refresh();
				void vscode.window.showInformationMessage(`Pushed to ${remote} ${previewCount}`.trim());
			} catch (e) {
				if (!(await handleGitConflict(service, 'Push'))) {
					void vscode.window.showErrorMessage(`Push failed: ${errMsg(e)}`);
				}
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.updateProject', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const pick = await vscode.window.showQuickPick(
				[
					{ label: 'Merge strategy (default)', description: 'pull --no-rebase', args: ['pull', '--no-rebase'] },
					{ label: 'Rebase strategy', description: 'pull --rebase (linear history)', args: ['pull', '--rebase'] },
				],
				{ placeHolder: 'Update Project: pull and integrate remote changes' },
			);
			if (!pick) {
				return;
			}
			try {
				await service.execGit(pick.args);
				branchesTree.refresh();
				logTree.refresh();
				void vscode.window.showInformationMessage('Update Project complete');
			} catch (e) {
				if (!(await handleGitConflict(service, 'Update'))) {
					void vscode.window.showErrorMessage(`Update failed: ${errMsg(e)}`);
				}
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.mergeDialog', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const refs = repo.state.refs.filter((r) => r.name && (r.type === 0 || r.type === 1));
			const target = await vscode.window.showQuickPick(refs.map((r) => r.name!), { placeHolder: 'Merge which branch into the current branch' });
			if (!target) {
				return;
			}
			const mode = await vscode.window.showQuickPick(
				[
					{ label: 'Fast-forward only', description: 'Merge only when fast-forward is possible', args: ['--ff-only'] },
					{ label: 'No fast-forward', description: 'Always create a merge commit', args: ['--no-ff'] },
					{ label: 'Squash', description: 'Squash into a single commit (no merge commit)', args: ['--squash'] },
				],
				{ placeHolder: `Merge mode (${target} → current branch)` },
			);
			if (!mode) {
				return;
			}
			const msgArgs: string[] = [];
			if (mode.args[0] !== '--ff-only') {
				const msg = await vscode.window.showInputBox({ prompt: 'Merge commit message', value: `Merge ${target}` });
				if (msg && msg.trim()) {
					msgArgs.push('-m', msg.trim());
				}
			}
			try {
				await service.execGit(['merge', ...mode.args, ...msgArgs, target]);
				branchesTree.refresh();
				logTree.refresh();
				void vscode.window.showInformationMessage(`Merged ${target}`);
			} catch (e) {
				if (!(await handleGitConflict(service, 'Merge'))) {
					void vscode.window.showErrorMessage(`Merge failed: ${errMsg(e)}`);
				}
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.deleteRemoteBranch', async (node: BranchNode, nodes?: BranchNode[]) => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			// 仅远程、非 tag（多选时自动过滤本地/标签节点）。
			const refs = selectedBranchRefs(node, nodes, (r) => r.isRemote && !r.isTag);
			if (refs.length === 0) {
				return;
			}
			const remotes = repo.state.remotes.map((r) => r.name);
			if (remotes.length === 0) {
				void vscode.window.showWarningMessage('No remote repository configured');
				return;
			}
			// 用已知 remotes 做最长前缀匹配解析 {remote, branch}；丢弃无法归属的脏数据。
			const targets = refs
				.map((r) => resolveRemoteBranch(r.shortName, remotes))
				.filter((t): t is RemoteBranchTarget => t !== null);
			if (targets.length === 0) {
				void vscode.window.showWarningMessage('Could not resolve the owning remote of the selected remote branches');
				return;
			}
			// 受保护主干（main/master）硬阻断——与本地删除硬阻断当前 HEAD 对称。
			const { deletable, protectedTargets } = partitionRemoteByProtected(targets);
			if (deletable.length === 0) {
				void vscode.window.showWarningMessage(`Skipped protected branches: ${truncateNames(protectedTargets.map((t) => t.shortName))}`);
				return;
			}
			// 软警示：待删集合是否含当前分支上游（删之不致命，但令当前分支失远程追踪）。
			const headUpstream = repo.state.HEAD?.upstream?.name;
			const hasUpstreamOfHead = !!headUpstream && deletable.some((t) => t.shortName === headUpstream);
			const { detail, confirmLabel } = formatRemoteDeleteConfirm(deletable, { hasUpstreamOfHead });
			// 受保护跳过项透明并入文案。
			const fullDetail =
				protectedTargets.length > 0
					? `${detail}\n\nAutomatically skipped protected branches: ${truncateNames(protectedTargets.map((t) => t.shortName))}`
					: detail;
			const choice = await vscode.window.showWarningMessage(fullDetail, { modal: true }, confirmLabel);
			if (choice !== confirmLabel) {
				return;
			}
			// 逐分支推删，收集失败（不调用 handleGitConflict——删除不产生合并冲突）。
			const failures: string[] = [];
			const succeeded: RemoteBranchTarget[] = [];
			for (const t of deletable) {
				try {
					await service.execGit(['push', t.remote, '--delete', t.branch]);
					succeeded.push(t);
				} catch {
					failures.push(t.shortName);
				}
			}
			// 仅对服务端删除成功项清理本地 remote-tracking ref（失败项保留，待重试或下次 fetch --prune）。
			for (const t of succeeded) {
				try {
					await service.execGit(['branch', '-D', '-r', `${t.remote}/${t.branch}`]);
				} catch {
					/* 非关键：服务端已删为权威态，本地清理失败不影响正确性 */
				}
			}
			branchesTree.refresh();
			if (failures.length === 0) {
				void vscode.window.showInformationMessage(
					succeeded.length === 1 ? `Deleted remote branch ${succeeded[0].shortName}` : `Deleted ${succeeded.length} remote branches`,
				);
			} else {
				void vscode.window.showWarningMessage(
					`Deleted ${succeeded.length} remote branches, ${failures.length} failed: ${truncateNames(failures)}`,
				);
			}
		}),
	);

	return subs;
}
