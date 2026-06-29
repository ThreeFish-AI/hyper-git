import * as path from 'path';
import * as vscode from 'vscode';
import type { BranchNode } from './tree/branches-tree';
import type { BranchesTreeProvider } from './tree/branches-tree';
import type { BranchFavorites } from './branch-favorites';
import type { ChangeItem, GitRepositoryService } from './git-repository-service';
import type { LogNode, LogTreeProvider } from './tree/log-tree';
import { handleGitConflict } from './conflict-ui';
import type { MergeMode } from '../engine/log/log-filter';
import { selectedBranchRefs } from './branch-selection';
import { formatBranchDeleteConfirm, partitionByMerged, truncateNames } from '../engine/ref/cleanup';

/** 注册 Log/Branches/Blame/History/Tags 相关命令。 */
export function registerHistoryCommands(
	service: GitRepositoryService,
	logTree: LogTreeProvider,
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
				await repo.checkout(node.ref.shortName);
				branchesTree.refresh();
			} catch (e) {
				void vscode.window.showErrorMessage(`检出失败：${errMsg(e)}`);
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
					void vscode.window.showWarningMessage('当前分支无法删除');
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
				void vscode.window.showInformationMessage(deleted === 1 ? `已删除分支 ${names[0]}` : `已删除 ${deleted} 个分支`);
			} else {
				void vscode.window.showWarningMessage(`已删除 ${deleted} 个分支，${failures.length} 个失败：${truncateNames(failures)}`);
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
			const ok = await vscode.window.showWarningMessage(`将「${name}」合并到当前分支？`, { modal: true }, '合并');
			if (ok !== '合并') {
				return;
			}
			try {
				await repo.merge(name);
				branchesTree.refresh();
			} catch (e) {
				if (!(await handleGitConflict(service, '合并'))) {
					void vscode.window.showErrorMessage(`合并失败：${errMsg(e)}`);
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
			const ok = await vscode.window.showWarningMessage(`将当前分支变基到「${name}」？（重写历史，可能冲突）`, { modal: true }, '变基');
			if (ok !== '变基') {
				return;
			}
			try {
				await repo.rebase(name);
				branchesTree.refresh();
			} catch (e) {
				if (!(await handleGitConflict(service, '变基'))) {
					void vscode.window.showErrorMessage(`变基失败：${errMsg(e)}`);
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
				void vscode.window.showWarningMessage('请先打开一个文件');
				return;
			}
			const rel = path.relative(repo.rootUri.fsPath, editor.document.uri.fsPath).split(path.sep).join('/');
			if (rel.startsWith('..') || path.isAbsolute(rel)) {
				void vscode.window.showWarningMessage('该文件不在当前仓库内，无法 Blame');
				return;
			}
			try {
				const blame = await repo.blame(rel);
				const doc = await vscode.workspace.openTextDocument({ content: blame, language: 'plaintext' });
				await vscode.window.showTextDocument(doc, { preview: true });
			} catch (e) {
				void vscode.window.showErrorMessage(`Blame 失败：${errMsg(e)}`);
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
					void vscode.window.showErrorMessage(`Pull 失败：${errMsg(e)}`);
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
				void vscode.window.showWarningMessage('当前处于 detached HEAD，无法推送当前分支');
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
						void vscode.window.showWarningMessage('未配置远程仓库（remote），无法推送');
						return;
					}
					const remote =
						remotes.length === 1
							? remotes[0]
							: await vscode.window.showQuickPick(remotes, {
								placeHolder: `为「${head.name}」选择推送目标 remote（将建立上游追踪 -u）`,
							});
					if (!remote) {
						return;
					}
					await repo.push(remote, head.name, true);
				}
				branchesTree.refresh();
				void vscode.window.showInformationMessage(`已推送 ${head.name}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Push 失败：${errMsg(e)}`);
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
				['普通 Fetch', 'Fetch + Prune（清理已删除的远程分支）'],
				{ placeHolder: 'Fetch 模式' },
			);
			if (!pick) {
				return;
			}
			try {
				await repo.fetch(pick.includes('Prune') ? { prune: true } : undefined);
				branchesTree.refresh();
			} catch (e) {
				void vscode.window.showErrorMessage(`Fetch 失败：${errMsg(e)}`);
			}
		}),
	);

	// —— IDEA 风格 Branches 高级操作（Phase 1）——

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
			const name = await vscode.window.showInputBox({ prompt: `从「${source}」新建并检出本地分支`, placeHolder: '新分支名' });
			if (!name || !name.trim()) {
				return;
			}
			try {
				await repo.createBranch(name.trim(), true, source);
				branchesTree.refresh();
			} catch (e) {
				void vscode.window.showErrorMessage(`新建分支失败：${errMsg(e)}`);
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
				void vscode.window.showErrorMessage(`比较失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.tagCreate', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const name = await vscode.window.showInputBox({ prompt: '标签名（如 v1.0.0）' });
			if (!name || !name.trim()) {
				return;
			}
			const commits = await repo.log({ maxEntries: 20 });
			const items = [
				{ label: 'HEAD', description: '当前提交', target: 'HEAD' },
				...commits.map((c) => ({
					label: (c.message.split('\n', 1)[0] ?? c.hash).slice(0, 50),
					description: c.hash.slice(0, 7),
					target: c.hash,
				})),
			];
			const pick = await vscode.window.showQuickPick(items, { placeHolder: '在哪个 commit 上打标签' });
			if (!pick) {
				return;
			}
			try {
				await service.execGit(['tag', name.trim(), pick.target]);
				branchesTree.refresh();
				void vscode.window.showInformationMessage(`已创建标签 ${name.trim()} @ ${pick.target === 'HEAD' ? 'HEAD' : pick.target.slice(0, 7)}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`创建标签失败：${errMsg(e)}`);
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
			const detail = names.length === 1 ? `删除标签「${names[0]}」？` : `将删除 ${names.length} 个标签：${truncateNames(names)}`;
			const ok = await vscode.window.showWarningMessage(detail, { modal: true }, '删除');
			if (ok !== '删除') {
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
				void vscode.window.showInformationMessage(deleted === 1 ? `已删除标签 ${names[0]}` : `已删除 ${deleted} 个标签`);
			} else {
				void vscode.window.showWarningMessage(`已删除 ${deleted} 个标签，${failures.length} 个失败：${truncateNames(failures)}`);
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
			const ok = await vscode.window.showWarningMessage(`检出标签「${name}」（进入 detached HEAD）？`, { modal: true }, '检出');
			if (ok !== '检出') {
				return;
			}
			try {
				await repo.checkout(name);
				branchesTree.refresh();
			} catch (e) {
				void vscode.window.showErrorMessage(`检出标签失败：${errMsg(e)}`);
			}
		}),
	);

	// —— IDEA Log 增强（Phase 2）：高级过滤 + 提交详情 diff + per-commit 操作 ——

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
				void vscode.window.showErrorMessage(`打开 diff 失败：${errMsg(e)}`);
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
				{ label: 'soft', description: '仅移动 HEAD，保留暂存区与工作区改动' },
				{ label: 'mixed', description: '移动 HEAD + 取消暂存（默认），保留工作区改动' },
				{ label: 'hard', description: '⚠ 移动 HEAD + 丢弃暂存区与工作区所有改动（不可撤销）' },
				{ label: 'keep', description: '移动 HEAD + 保留已修改文件（遇冲突中止）' },
			];
			const pick = await vscode.window.showQuickPick(items, { placeHolder: `Reset 当前分支到 ${hash.slice(0, 7)} 的模式` });
			if (!pick) {
				return;
			}
			if (pick.label === 'hard') {
				const ok = await vscode.window.showWarningMessage(`hard reset 到 ${hash.slice(0, 7)} 将丢弃所有改动，确认？`, { modal: true }, '确认 hard reset');
				if (!ok) {
					return;
				}
			}
			try {
				await service.execGit(['reset', `--${pick.label}`, hash]);
				branchesTree.refresh();
				logTree.refresh();
				void vscode.window.showInformationMessage(`Reset (--${pick.label} ${hash.slice(0, 7)}) 完成`);
			} catch (e) {
				if (!(await handleGitConflict(service, 'Reset'))) {
					void vscode.window.showErrorMessage(`Reset 失败：${errMsg(e)}`);
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
			const name = await vscode.window.showInputBox({ prompt: `从 ${node.commit.hash.slice(0, 7)} 新建并检出分支`, placeHolder: '新分支名' });
			if (!name || !name.trim()) {
				return;
			}
			try {
				await repo.createBranch(name.trim(), true, node.commit.hash);
				branchesTree.refresh();
				void vscode.window.showInformationMessage(`已新建并检出 ${name.trim()} @ ${node.commit.hash.slice(0, 7)}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`新建分支失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.createTagFromCommit', async (node: LogNode) => {
			if (node?.kind !== 'commit') {
				return;
			}
			const name = await vscode.window.showInputBox({ prompt: `在 ${node.commit.hash.slice(0, 7)} 上新建标签`, placeHolder: '如 v1.0.0' });
			if (!name || !name.trim()) {
				return;
			}
			try {
				await service.execGit(['tag', name.trim(), node.commit.hash]);
				branchesTree.refresh();
				void vscode.window.showInformationMessage(`已创建标签 ${name.trim()} @ ${node.commit.hash.slice(0, 7)}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`创建标签失败：${errMsg(e)}`);
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
				void vscode.window.showErrorMessage(`查询失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.logFilterGrep', async () => {
			const grep = await vscode.window.showInputBox({ prompt: '按 message 文本/正则过滤（--grep）', placeHolder: '例如 fix|bug' });
			const f = logTree.getFilter();
			logTree.setFilter({ ...f, grep: grep && grep.trim() ? grep.trim() : undefined });
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.logFilterMergeMode', async () => {
			const pick = await vscode.window.showQuickPick(
				[
					{ label: '全部提交', mode: 'all' as MergeMode },
					{ label: '仅合并提交（merge）', mode: 'merge-only' as MergeMode },
					{ label: '仅非合并提交', mode: 'no-merge' as MergeMode },
				],
				{ placeHolder: '合并提交过滤模式' },
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
					{ label: '最近 7 天', days: 7 },
					{ label: '最近 30 天', days: 30 },
					{ label: '最近 90 天', days: 90 },
					{ label: '清除日期过滤', days: 0 },
				],
				{ placeHolder: '提交日期范围' },
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
			const re = await vscode.window.showInputBox({ prompt: '按 message 正则过滤（客户端）', placeHolder: '例如 ^feat:' });
			const f = logTree.getFilter();
			logTree.setFilter({ ...f, messageRegex: re && re.trim() ? re.trim() : undefined });
		}),
	);

	return subs;
}
