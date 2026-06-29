import * as path from 'path';
import * as vscode from 'vscode';
import type { BranchNode } from './tree/branches-tree';
import type { BranchesTreeProvider } from './tree/branches-tree';
import type { BranchFavorites } from './branch-favorites';
import type { ChangeItem, GitRepositoryService } from './git-repository-service';
import type { LogNode, LogTreeProvider } from './tree/log-tree';
import { handleGitConflict } from './conflict-ui';

/** 注册 Log/Branches/Blame/History/Tags 相关命令。 */
export function registerHistoryCommands(
	service: GitRepositoryService,
	logTree: LogTreeProvider,
	branchesTree: BranchesTreeProvider,
	favorites: BranchFavorites,
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
				await repo.checkout(node.ref.shortName);
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
			const name = node.ref.shortName;
			// 查询是否已合并：已合并用安全删除（-d / force=false），未合并需二次确认强制删除（-D / force=true）
			const merged = await isBranchMerged(service, name);
			const detail = merged
				? `分支「${name}」已合并，可安全删除。`
				: `分支「${name}」未合并，强制删除将丢失其独有提交！`;
			const confirmText = merged ? '删除' : '强制删除';
			const choice = await vscode.window.showWarningMessage(detail, { modal: true }, confirmText);
			if (choice === confirmText) {
				try {
					await repo.deleteBranch(name, !merged);
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
			try {
				await repo.push();
				branchesTree.refresh();
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
			try {
				await repo.fetch();
				branchesTree.refresh();
			} catch (e) {
				void vscode.window.showErrorMessage(`Fetch 失败：${errMsg(e)}`);
			}
		}),
	);

	// —— IDEA 风格 Branches 高级操作（Phase 1）——

	subs.push(
		vscode.commands.registerCommand('hyperGit.toggleFavorite', async (node: BranchNode) => {
			if (node?.kind !== 'branch' || node.ref.isTag) {
				return;
			}
			favorites.toggle(node.ref.shortName);
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
		vscode.commands.registerCommand('hyperGit.tagDelete', async (node: BranchNode) => {
			if (node?.kind !== 'branch' || !node.ref.isTag) {
				return;
			}
			const name = node.ref.shortName;
			const ok = await vscode.window.showWarningMessage(`删除标签「${name}」？`, { modal: true }, '删除');
			if (ok !== '删除') {
				return;
			}
			try {
				await service.execGit(['tag', '-d', name]);
				branchesTree.refresh();
			} catch (e) {
				void vscode.window.showErrorMessage(`删除标签失败：${errMsg(e)}`);
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

	return subs;
}

/** 查询本地分支是否已合并到当前 HEAD（或 main）：经 `git branch --merged <base>`。 */
async function isBranchMerged(service: GitRepositoryService, branch: string): Promise<boolean> {
	const repo = service.repo;
	if (!repo) {
		return false;
	}
	const base = repo.state.HEAD?.name ?? 'main';
	try {
		const out = await service.execGit(['branch', '--merged', base]);
		return out.split('\n').some((line) => line.replace(/^\*\s*/, '').trim() === branch);
	} catch {
		return false;
	}
}
