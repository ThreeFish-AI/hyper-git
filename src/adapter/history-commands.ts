import * as path from 'path';
import * as vscode from 'vscode';
import type { BranchNode } from './tree/branches-tree';
import type { BranchesTreeProvider } from './tree/branches-tree';
import type { BranchFavorites } from './branch-favorites';
import type { ChangeItem, GitRepositoryService } from './git-repository-service';
import type { LogFilterControl, LogNode } from './webview/log-webview';
import { handleGitConflict } from './conflict-ui';
import type { MergeMode } from '../engine/log/log-filter';
import { selectedBranchRefs } from './branch-selection';
import { diffPrunedRefs, formatBranchDeleteConfirm, partitionByMerged, truncateNames } from '../engine/ref/cleanup';

/** 注册 Log/Branches/Blame/History/Tags 相关命令。 */
export function registerHistoryCommands(
	service: GitRepositoryService,
	logTree: LogFilterControl,
	branchesTree: BranchesTreeProvider,
	favorites: BranchFavorites,
): vscode.Disposable[] {
	const subs: vscode.Disposable[] = [];
	// vscode.git 在 git 非零退出时抛出 GitError，其 .message 为通用串「Failed to execute git」，
	// 真实原因落在 .stderr。优先暴露 stderr，使「无上游」「non-fast-forward」等失败可读。
	const errMsg = (e: unknown): string => {
		if (e && typeof e === 'object') {
			const ge = e as { stderr?: unknown; message?: unknown };
			if (typeof ge.stderr === 'string' && ge.stderr.trim()) {
				return ge.stderr.trim();
			}
			if (typeof ge.message === 'string' && ge.message) {
				return ge.message;
			}
		}
		return String(e);
	};

	subs.push(vscode.commands.registerCommand('hyperGit.refreshLog', () => logTree.refresh()));
	subs.push(vscode.commands.registerCommand('hyperGit.refreshBranches', () => branchesTree.refresh()));

	subs.push(
		vscode.commands.registerCommand('hyperGit.logFilterAuthor', async () => {
			const author = await vscode.window.showInputBox({ prompt: 'Filter by Author', placeHolder: 'e.g. John' });
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
		vscode.commands.registerCommand('hyperGit.logFilter', async () => {
			// 过滤器聚合入口：QuickPick 分发到既有 6 个过滤命令（复用 handler，零重复实现）。
			const items = [
				{ label: 'Filter by Author…', description: 'commits by author', action: 'hyperGit.logFilterAuthor' },
				{ label: 'Filter by Path…', description: 'commits touching a path', action: 'hyperGit.logFilterPath' },
				{ label: 'Filter by Message (grep)…', description: 'substring match', action: 'hyperGit.logFilterGrep' },
				{ label: 'Filter by Message (regex)…', description: 'regular expression', action: 'hyperGit.logFilterRegex' },
				{ label: 'Filter Merge Commits…', description: 'show or hide merge commits', action: 'hyperGit.logFilterMergeMode' },
				{ label: 'Filter by Date…', description: 'commits within recent days', action: 'hyperGit.logFilterDate' },
				{ label: 'Clear Filter', description: 'remove all active filters', action: 'hyperGit.logClearFilter' },
			];
			const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Filter commit log' });
			if (pick) {
				await vscode.commands.executeCommand(pick.action);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.copyCommitHash', (node: LogNode) => {
			if (node?.kind === 'commit') {
				void vscode.env.clipboard.writeText(node.commit.hash);
				void vscode.window.showInformationMessage(`Copied ${node.commit.hash.slice(0, 7)}`);
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
			const name = await vscode.window.showInputBox({ prompt: 'New branch name' });
			if (name && name.trim()) {
				try {
					await repo.createBranch(name.trim(), true);
					branchesTree.refresh();
				} catch (e) {
					void vscode.window.showErrorMessage(`Failed to create branch: ${errMsg(e)}`);
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
				await repo.checkout(node.ref.shortName);
				branchesTree.refresh();
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to checkout: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.branchDelete', async (node: BranchNode, nodes?: BranchNode[]) => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			// 仅本地、非当前 HEAD 可删（ref.head 直接排除当前分支，无需解析名字）；支持多选批量。
			const refs = selectedBranchRefs(node, nodes, (r) => !r.isRemote && !r.isTag && !r.head);
			const names = refs.map((r) => r.shortName);
			if (names.length === 0) {
				if (node?.kind === 'branch' && node.ref.head) {
					void vscode.window.showWarningMessage('Cannot delete the current branch');
				}
				return;
			}
			// 一次查询已合并集合（避免逐个 git branch --merged）：已合并安全删除（-d），未合并强制删除（-D）。
			const base = repo.state.HEAD?.name ?? 'main';
			let mergedOut = '';
			try {
				mergedOut = await service.execGit(['branch', '--merged', base]);
			} catch {
				/* 查询失败则视为全部未合并，确认弹窗会以强制删除提示 */
			}
			const { merged, unmerged } = partitionByMerged(mergedOut, names);
			const mergedSet = new Set(merged);
			const { detail, confirmLabel } = formatBranchDeleteConfirm(merged, unmerged);
			const choice = await vscode.window.showWarningMessage(detail, { modal: true }, confirmLabel);
			if (choice !== confirmLabel) {
				return;
			}
			const failures: string[] = [];
			let deleted = 0;
			for (const name of names) {
				try {
					await repo.deleteBranch(name, !mergedSet.has(name));
					deleted++;
				} catch {
					failures.push(name);
				}
			}
			branchesTree.refresh();
			if (failures.length === 0) {
				void vscode.window.showInformationMessage(deleted === 1 ? `Deleted branch ${names[0]}` : `Deleted ${deleted} branches`);
			} else {
				void vscode.window.showWarningMessage(`Deleted ${deleted} branches, ${failures.length} failed: ${truncateNames(failures)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.mergeBranch', async (node: BranchNode) => {
			const repo = service.repo;
			if (!repo || node?.kind !== 'branch') {
				return;
			}
			const name = node.ref.shortName;
			const ok = await vscode.window.showWarningMessage(`Merge "${name}" into current branch?`, { modal: true }, 'Merge');
			if (ok !== 'Merge') {
				return;
			}
			try {
				await repo.merge(name);
				branchesTree.refresh();
			} catch (e) {
				if (!(await handleGitConflict(service, 'Merge'))) {
					void vscode.window.showErrorMessage(`Failed to merge: ${errMsg(e)}`);
				}
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.rebaseBranch', async (node: BranchNode) => {
			const repo = service.repo;
			if (!repo || node?.kind !== 'branch') {
				return;
			}
			const name = node.ref.shortName;
			const ok = await vscode.window.showWarningMessage(`Rebase current branch onto "${name}"? (this rewrites history and may conflict)`, { modal: true }, 'Rebase');
			if (ok !== 'Rebase') {
				return;
			}
			try {
				await repo.rebase(name);
				branchesTree.refresh();
			} catch (e) {
				if (!(await handleGitConflict(service, 'Rebase'))) {
					void vscode.window.showErrorMessage(`Failed to rebase: ${errMsg(e)}`);
				}
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
				void vscode.window.showWarningMessage('Please open a file first');
				return;
			}
			const rel = path.relative(repo.rootUri.fsPath, editor.document.uri.fsPath).split(path.sep).join('/');
			if (rel.startsWith('..') || path.isAbsolute(rel)) {
				void vscode.window.showWarningMessage('This file is outside the current repository; cannot Blame');
				return;
			}
			try {
				const blame = await repo.blame(rel);
				const doc = await vscode.workspace.openTextDocument({ content: blame, language: 'plaintext' });
				await vscode.window.showTextDocument(doc, { preview: true });
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to Blame: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.pull', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			try {
				await repo.pull();
				branchesTree.refresh();
			} catch (e) {
				if (!(await handleGitConflict(service, 'Pull'))) {
					void vscode.window.showErrorMessage(`Failed to Pull: ${errMsg(e)}`);
				}
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.push', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const head = repo.state.HEAD;
			if (!head?.name) {
				void vscode.window.showWarningMessage('Currently in detached HEAD; cannot push the current branch');
				return;
			}
			try {
				if (head.upstream) {
					// 已配置上游：按 push.default 推送到追踪分支（正确处理本地名/上游名不一致）。
					await repo.push();
				} else {
					// 无上游：选定 remote 并以 -u 建立追踪（修复「Failed to execute git」根因）。
					const remotes = repo.state.remotes.map((r) => r.name);
					if (remotes.length === 0) {
						void vscode.window.showWarningMessage('No remote configured; cannot push');
						return;
					}
					const remote =
						remotes.length === 1
							? remotes[0]
							: await vscode.window.showQuickPick(remotes, {
								placeHolder: `Select a remote to push "${head.name}" to (will set upstream tracking -u)`,
							});
					if (!remote) {
						return;
					}
					await repo.push(remote, head.name, true);
				}
				branchesTree.refresh();
				void vscode.window.showInformationMessage(`Pushed ${head.name}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to Push: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.fetch', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const pick = await vscode.window.showQuickPick(
				['Fetch', 'Fetch + Prune (clean up deleted remote branches)'],
				{ placeHolder: 'Fetch mode' },
			);
			if (!pick) {
				return;
			}
			try {
				await repo.fetch(pick.includes('Prune') ? { prune: true } : undefined);
				branchesTree.refresh();
				logTree.refresh();
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to Fetch: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.pruneRemotes', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const remotes = repo.state.remotes.map((r) => r.name);
			if (remotes.length === 0) {
				void vscode.window.showWarningMessage('No remote repository configured');
				return;
			}
			// prune 前后对 refs/remotes 各快照一次，差集即为被清理的陈旧跟踪引用。
			// `--prune` 的 [deleted] 明细走 stderr，execGit 仅回传 stdout，故用快照差集做循证反馈。
			const before = await listRemoteTrackingRefs(service);
			const failed: string[] = [];
			// 逐 remote 执行 fetch --prune：API 的 FetchOptions 仅接受单 remote，遍历以覆盖多远程场景。
			for (const remote of remotes) {
				try {
					await repo.fetch({ remote, prune: true });
				} catch {
					failed.push(remote);
				}
			}
			const after = await listRemoteTrackingRefs(service);
			const pruned = diffPrunedRefs(before, after);
			branchesTree.refresh();
			logTree.refresh();
			if (pruned.length === 0) {
				void vscode.window.showInformationMessage(
					failed.length > 0 ? `Prune failed for: ${truncateNames(failed)}` : 'No stale remote branches to prune',
				);
			} else {
				void vscode.window.showInformationMessage(
					`Pruned ${pruned.length} stale remote branch(es): ${truncateNames(pruned)}`,
				);
			}
		}),
	);

	// —— Branches 高级操作（Phase 1）——

	subs.push(
		vscode.commands.registerCommand('hyperGit.toggleFavorite', async (node: BranchNode, nodes?: BranchNode[]) => {
			// 支持多选批量切换收藏（标签无收藏语义，谓词排除）。
			const refs = selectedBranchRefs(node, nodes, (r) => !r.isTag);
			for (const r of refs) {
				favorites.toggle(r.shortName);
			}
			// favorites.onDidChange 会触发 branchesTree.refresh()
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.checkoutAsNew', async (node: BranchNode) => {
			const repo = service.repo;
			if (!repo || node?.kind !== 'branch') {
				return;
			}
			const source = node.ref.shortName;
			const name = await vscode.window.showInputBox({ prompt: `Create and checkout a new local branch from "${source}"`, placeHolder: 'New branch name' });
			if (!name || !name.trim()) {
				return;
			}
			try {
				await repo.createBranch(name.trim(), true, source);
				branchesTree.refresh();
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to create branch: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.compareWithCurrent', async (node: BranchNode) => {
			const repo = service.repo;
			if (!repo || node?.kind !== 'branch') {
				return;
			}
			const selected = node.ref.shortName;
			try {
				const out = await service.execGit(['diff', '--stat', `HEAD...${selected}`]);
				const doc = await vscode.workspace.openTextDocument({ content: `$ git diff --stat HEAD...${selected}\n\n${out}`, language: 'plaintext' });
				await vscode.window.showTextDocument(doc, { preview: true });
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to compare: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.tagCreate', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const name = await vscode.window.showInputBox({ prompt: 'Tag name (e.g. v1.0.0)' });
			if (!name || !name.trim()) {
				return;
			}
			const commits = await repo.log({ maxEntries: 20 });
			const items = [
				{ label: 'HEAD', description: 'Current commit', target: 'HEAD' },
				...commits.map((c) => ({
					label: (c.message.split('\n', 1)[0] ?? c.hash).slice(0, 50),
					description: c.hash.slice(0, 7),
					target: c.hash,
				})),
			];
			const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Choose a commit to tag' });
			if (!pick) {
				return;
			}
			try {
				await service.execGit(['tag', name.trim(), pick.target]);
				branchesTree.refresh();
				void vscode.window.showInformationMessage(`Created tag ${name.trim()} @ ${pick.target === 'HEAD' ? 'HEAD' : pick.target.slice(0, 7)}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to create tag: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.tagDelete', async (node: BranchNode, nodes?: BranchNode[]) => {
			// 支持多选批量删除标签。
			const names = selectedBranchRefs(node, nodes, (r) => r.isTag).map((r) => r.shortName);
			if (names.length === 0) {
				return;
			}
			const detail = names.length === 1 ? `Delete tag "${names[0]}"?` : `Will delete ${names.length} tags: ${truncateNames(names)}`;
			const ok = await vscode.window.showWarningMessage(detail, { modal: true }, 'Delete');
			if (ok !== 'Delete') {
				return;
			}
			const failures: string[] = [];
			let deleted = 0;
			for (const name of names) {
				try {
					await service.execGit(['tag', '-d', name]);
					deleted++;
				} catch {
					failures.push(name);
				}
			}
			branchesTree.refresh();
			if (failures.length === 0) {
				void vscode.window.showInformationMessage(deleted === 1 ? `Deleted tag ${names[0]}` : `Deleted ${deleted} tags`);
			} else {
				void vscode.window.showWarningMessage(`Deleted ${deleted} tags, ${failures.length} failed: ${truncateNames(failures)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.tagCheckout', async (node: BranchNode) => {
			const repo = service.repo;
			if (!repo || node?.kind !== 'branch' || !node.ref.isTag) {
				return;
			}
			const name = node.ref.shortName;
			const ok = await vscode.window.showWarningMessage(`Checkout tag "${name}" (entering detached HEAD)?`, { modal: true }, 'Checkout');
			if (ok !== 'Checkout') {
				return;
			}
			try {
				await repo.checkout(name);
				branchesTree.refresh();
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to checkout tag: ${errMsg(e)}`);
			}
		}),
	);

	// —— Log 增强（Phase 2）：高级过滤 + 提交详情 diff + per-commit 操作 ——

	subs.push(
		vscode.commands.registerCommand('hyperGit.openCommitFileDiff', async (hash: string, filePath: string, hasParent: boolean) => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const uri = vscode.Uri.joinPath(repo.rootUri, filePath);
			const right = service.toGitUri(uri, hash);
			try {
				if (hasParent) {
					const left = service.toGitUri(uri, `${hash}^`);
					await vscode.commands.executeCommand('vscode.diff', left, right, `${filePath} · ${hash.slice(0, 7)} (commit diff)`, { preview: true });
				} else {
					await vscode.commands.executeCommand('vscode.open', right);
				}
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to open diff: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.resetToHere', async (node: LogNode) => {
			if (node?.kind !== 'commit') {
				return;
			}
			const hash = node.commit.hash;
			const items = [
				{ label: 'soft', description: 'Move HEAD only; keep staged and working changes' },
				{ label: 'mixed', description: 'Move HEAD + unstage (default); keep working changes' },
				{ label: 'hard', description: '⚠ Move HEAD + discard all staged and working changes (cannot be undone)' },
				{ label: 'keep', description: 'Move HEAD + keep modified files (aborts on conflict)' },
			];
			const pick = await vscode.window.showQuickPick(items, { placeHolder: `Reset mode for current branch to ${hash.slice(0, 7)}` });
			if (!pick) {
				return;
			}
			if (pick.label === 'hard') {
				const ok = await vscode.window.showWarningMessage(`Hard reset to ${hash.slice(0, 7)} will discard all changes. Confirm?`, { modal: true }, 'Confirm Hard Reset');
				if (!ok) {
					return;
				}
			}
			try {
				await service.execGit(['reset', `--${pick.label}`, hash]);
				branchesTree.refresh();
				logTree.refresh();
				void vscode.window.showInformationMessage(`Reset (--${pick.label} ${hash.slice(0, 7)}) complete`);
			} catch (e) {
				if (!(await handleGitConflict(service, 'Reset'))) {
					void vscode.window.showErrorMessage(`Failed to Reset: ${errMsg(e)}`);
				}
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.createBranchFromCommit', async (node: LogNode) => {
			const repo = service.repo;
			if (!repo || node?.kind !== 'commit') {
				return;
			}
			const name = await vscode.window.showInputBox({ prompt: `Create and checkout a new branch from ${node.commit.hash.slice(0, 7)}`, placeHolder: 'New branch name' });
			if (!name || !name.trim()) {
				return;
			}
			try {
				await repo.createBranch(name.trim(), true, node.commit.hash);
				branchesTree.refresh();
				void vscode.window.showInformationMessage(`Created and checked out ${name.trim()} @ ${node.commit.hash.slice(0, 7)}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to create branch: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.createTagFromCommit', async (node: LogNode) => {
			if (node?.kind !== 'commit') {
				return;
			}
			const name = await vscode.window.showInputBox({ prompt: `Create a new tag at ${node.commit.hash.slice(0, 7)}`, placeHolder: 'e.g. v1.0.0' });
			if (!name || !name.trim()) {
				return;
			}
			try {
				await service.execGit(['tag', name.trim(), node.commit.hash]);
				branchesTree.refresh();
				void vscode.window.showInformationMessage(`Created tag ${name.trim()} @ ${node.commit.hash.slice(0, 7)}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to create tag: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.showContainingBranches', async (node: LogNode) => {
			if (node?.kind !== 'commit') {
				return;
			}
			try {
				const out = await service.execGit(['branch', '--contains', node.commit.hash]);
				const doc = await vscode.workspace.openTextDocument({
					content: `$ git branch --contains ${node.commit.hash.slice(0, 7)}\n\n${out}`,
					language: 'plaintext',
				});
				await vscode.window.showTextDocument(doc, { preview: true });
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to query: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.logFilterGrep', async () => {
			const grep = await vscode.window.showInputBox({ prompt: 'Filter by message text/regex (--grep)', placeHolder: 'e.g. fix|bug' });
			const f = logTree.getFilter();
			logTree.setFilter({ ...f, grep: grep && grep.trim() ? grep.trim() : undefined });
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.logFilterMergeMode', async () => {
			const pick = await vscode.window.showQuickPick(
				[
					{ label: 'All Commits', mode: 'all' as MergeMode },
					{ label: 'Merge Commits Only', mode: 'merge-only' as MergeMode },
					{ label: 'Non-Merge Commits Only', mode: 'no-merge' as MergeMode },
				],
				{ placeHolder: 'Merge commit filter mode' },
			);
			if (!pick) {
				return;
			}
			const f = logTree.getFilter();
			logTree.setFilter({ ...f, mergeMode: pick.mode });
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.logFilterDate', async () => {
			const now = Date.now();
			const pick = await vscode.window.showQuickPick(
				[
					{ label: 'Last 7 Days', days: 7 },
					{ label: 'Last 30 Days', days: 30 },
					{ label: 'Last 90 Days', days: 90 },
					{ label: 'Clear Date Filter', days: 0 },
				],
				{ placeHolder: 'Commit date range' },
			);
			if (!pick) {
				return;
			}
			const f = logTree.getFilter();
			logTree.setFilter({ ...f, dateFrom: pick.days === 0 ? undefined : new Date(now - pick.days * 86_400_000) });
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.logFilterRegex', async () => {
			const re = await vscode.window.showInputBox({ prompt: 'Filter by message regex (client-side)', placeHolder: 'e.g. ^feat:' });
			const f = logTree.getFilter();
			logTree.setFilter({ ...f, messageRegex: re && re.trim() ? re.trim() : undefined });
		}),
	);

	return subs;
}

/**
 * 列出当前 `refs/remotes/*` 短名（如 `origin/master`），供 prune 前后做差集。
 * 解析 `git for-each-ref --format=%(refname:short) refs/remotes`：逐行去空白、去空行。
 * 失败返回空数组（非关键路径，调用方据此跳过差集）。
 */
async function listRemoteTrackingRefs(service: GitRepositoryService): Promise<string[]> {
	try {
		const out = await service.execGit(['for-each-ref', '--format=%(refname:short)', 'refs/remotes']);
		return out
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	} catch {
		return [];
	}
}
