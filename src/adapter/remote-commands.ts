import * as vscode from 'vscode';
import { showGitError } from './notify';
import { runWithProgress } from './task-progress';
import { selectedBranchRefs } from './branch-selection';
import { handleGitConflict } from './conflict-ui';
import type { BranchNode, BranchesTreeProvider } from './tree/branches-tree';
import type { LogFilterControl } from './webview/log-webview';
import { truncateNames } from '../engine/ref/cleanup';
import {
	formatRemoteDeleteConfirm,
	formatRemoteDeleteResult,
	isRemoteRefMissingError,
	partitionRemoteByProtected,
	resolveRemoteBranch,
	type RemoteBranchTarget,
	type RemoteDeleteFailure,
} from '../engine/ref/remote-ref';
import { FOR_EACH_REF_FORMAT, parseForEachRef, type RawRef } from '../engine/ref/for-each-ref';
import {
	planBranchUpdates,
	formatBranchUpdateResult,
	type BranchUpdateAction,
	type BranchUpdateFailure,
} from '../engine/ref/branch-update';
import type { GitRepositoryService } from './git-repository-service';
import { gitErrorText } from '../engine/git-state/git-error';

/**
 * 注册远程同步命令（Phase 3 起）：Push 对话框 / Update Project / Merge 对话框 / 分支就地更新 / 删远程分支。
 *
 * vscode.git 稳定 API 的 pull/push 缺策略/force/tags 选项，故经 execGit 实现：
 * - Push：force/force-with-lease/push tags（核心走 repo.push，tags 走 CLI）。
 * - Update Project：pull --rebase / --no-rebase（策略）。
 * - Merge：--ff-only / --no-ff / --squash + 自定义 message。
 * - Update Branch：`git fetch <remote> <upstream>:refs/heads/<branch>`（原生 fast-forward-only，
 *   不 checkout 就地更新本地分支；当前分支改走 repo.pull）。
 */
export function registerRemoteCommands(
	service: GitRepositoryService,
	branchesTree: BranchesTreeProvider,
	logTree: LogFilterControl,
	branchesView: vscode.TreeView<BranchNode>,
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
					{ label: 'Force', description: '$(alert) Force overwrite remote (dangerous)', force: 0 as const },
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
				await runWithProgress('Pushing…', async () => {
					await repo.push(remote, undefined, false, mode.force);
					if (tags === 'Yes') {
						await service.execGit(['push', remote, '--tags']);
					}
				});
				branchesTree.refresh();
				logTree.refresh();
				void vscode.window.showInformationMessage(`Pushed to ${remote} ${previewCount}`.trim());
			} catch (e) {
				if (!(await handleGitConflict(service, 'Push'))) {
					void showGitError(`Push failed: ${gitErrorText(e)}`);
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
				await runWithProgress(`Updating project (${pick.args.join(' ')})…`, () => service.execGit(pick.args), {
					location: vscode.ProgressLocation.Notification,
				});
				branchesTree.refresh();
				logTree.refresh();
				void vscode.window.showInformationMessage('Update Project complete');
			} catch (e) {
				if (!(await handleGitConflict(service, 'Update'))) {
					void showGitError(`Update failed: ${gitErrorText(e)}`);
				}
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.branchUpdate', async (node?: BranchNode, nodes?: BranchNode[]) => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			// 目标解析链：右键实参 →（无实参的标题栏路径）视图选区 → 无选区等价 Pull（当前分支）。
			// 仅本地、非 tag（多选时自动过滤远程/标签节点）。
			const isLocal = (r: RawRef) => !r.isRemote && !r.isTag;
			let targets = selectedBranchRefs(node, nodes, isLocal);
			if (targets.length === 0 && !node) {
				targets = selectedBranchRefs(undefined, branchesView.selection, isLocal);
			}
			if (targets.length === 0) {
				if (node) {
					// 点击项非本地分支（防御；菜单门控 viewItem == hyperGit.branch 下不可达）。
					return;
				}
				const headName = repo.state.HEAD?.name;
				if (!headName) {
					void vscode.window.showWarningMessage('Currently in detached HEAD; no branch to update');
					return;
				}
				// 无选区 → 语义兜底为 Pull 当前分支，复用既有命令（含冲突通道）。
				await vscode.commands.executeCommand('hyperGit.pull');
				return;
			}
			// 新鲜快照：树节点 ref.upstream/head 在 API 路径下为空（refToRaw 不填），禁止信任节点数据。
			let snapshot: ReadonlyMap<string, RawRef>;
			try {
				const out = await service.execGit(['for-each-ref', `--format=${FOR_EACH_REF_FORMAT}`, 'refs/heads']);
				snapshot = new Map(parseForEachRef(out).map((r) => [r.shortName, r] as const));
			} catch (e) {
				void showGitError(`Failed to read branch info: ${gitErrorText(e)}`);
				return;
			}
			// 引擎纯逻辑排程 + 逐分支执行（per-item try/catch，三桶先例）。
			const remotes = repo.state.remotes.map((r) => r.name);
			const headName = repo.state.HEAD?.name;
			const plan = planBranchUpdates(
				targets.map((r) => r.shortName),
				snapshot,
				headName,
				remotes,
			);
			const skipped = plan.filter((a): a is Extract<BranchUpdateAction, { kind: 'skip-no-upstream' }> => a.kind === 'skip-no-upstream').map((a) => a.name);
			const updated: string[] = [];
			const upToDate: string[] = [];
			const pulled: string[] = [];
			const failures: BranchUpdateFailure[] = [];
			const failedNames = new Set<string>();
			await runWithProgress('Updating branch(es)…', async () => {
				for (const action of plan) {
					if (action.kind === 'skip-no-upstream') {
						continue;
					}
					try {
						if (action.kind === 'pull-current') {
							await repo.pull();
							pulled.push(action.name);
						} else {
							await service.execGit(['fetch', action.remote, `${action.upstreamBranch}:refs/heads/${action.name}`]);
						}
					} catch (e) {
						if (action.kind === 'pull-current') {
							// 冲突 UI 先行展示；仍按失败计数，维持「选中数 = 各桶之和」的对账诚实。
							await handleGitConflict(service, 'Pull');
						}
						failedNames.add(action.name);
						failures.push({ name: action.name, reason: gitErrorText(e) });
					}
				}
			});
			// 事后一次 for-each-ref：sha 对比分类 updated/upToDate（fetch 静默 no-op 无输出可解析）。
			try {
				const out = await service.execGit(['for-each-ref', `--format=${FOR_EACH_REF_FORMAT}`, 'refs/heads']);
				const after = new Map(parseForEachRef(out).map((r) => [r.shortName, r.objectname] as const));
				for (const a of plan) {
					if (a.kind !== 'fetch' || failedNames.has(a.name)) {
						continue;
					}
					(after.get(a.name) !== a.beforeSha ? updated : upToDate).push(a.name);
				}
			} catch {
				// 分类不可得 → 保守计 updated（fetch 已成功，仅失判定粒度）。
				for (const a of plan) {
					if (a.kind === 'fetch' && !failedNames.has(a.name)) {
						updated.push(a.name);
					}
				}
			}
			branchesTree.refresh();
			logTree.refresh();
			const result = formatBranchUpdateResult({ updated, upToDate, pulled, skipped, failures });
			if (result.level === 'info') {
				void vscode.window.showInformationMessage(result.message);
			} else {
				void showGitError(result.message);
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
				await runWithProgress(`Merging ${target}…`, () => service.execGit(['merge', ...mode.args, ...msgArgs, target]));
				branchesTree.refresh();
				logTree.refresh();
				void vscode.window.showInformationMessage(`Merged ${target}`);
			} catch (e) {
				if (!(await handleGitConflict(service, 'Merge'))) {
					void showGitError(`Merge failed: ${gitErrorText(e)}`);
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
			// 多行明细走 MessageOptions.detail（模态框次要文字载体），标题保持单行。
			const choice = await vscode.window.showWarningMessage('Delete remote branch(es)?', { modal: true, detail: fullDetail }, confirmLabel);
			if (choice !== confirmLabel) {
				return;
			}
			// 逐分支推删，三桶收集（不调用 handleGitConflict——删除不产生合并冲突）：
			// 成功 / 服务端已无此 ref（陈旧 tracking ref 场景，目标态已达成按成功收尾）/ 真失败（保留原因）。
			const failures: RemoteDeleteFailure[] = [];
			const succeeded: RemoteBranchTarget[] = [];
			const alreadyGone: RemoteBranchTarget[] = [];
			for (const t of deletable) {
				try {
					await service.execGit(['push', t.remote, '--delete', t.branch]);
					succeeded.push(t);
				} catch (e) {
					if (isRemoteRefMissingError(e)) {
						alreadyGone.push(t);
					} else {
						failures.push({ name: t.shortName, reason: gitErrorText(e) });
					}
				}
			}
			// 对服务端已无此分支的全部目标（含 alreadyGone 的陈旧项）清理本地 remote-tracking ref；
			// 真失败项保留，待重试或下次 fetch --prune。
			for (const t of [...succeeded, ...alreadyGone]) {
				try {
					await service.execGit(['branch', '-D', '-r', `${t.remote}/${t.branch}`]);
				} catch {
					/* 非关键：服务端已删为权威态，本地清理失败不影响正确性 */
				}
			}
			branchesTree.refresh();
			logTree.refresh();
			const result = formatRemoteDeleteResult(succeeded, alreadyGone, failures);
			if (result.level === 'info') {
				void vscode.window.showInformationMessage(result.message);
			} else {
				void showGitError(result.message);
			}
		}),
	);

	return subs;
}
