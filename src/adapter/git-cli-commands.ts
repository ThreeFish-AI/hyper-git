import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { BranchNode, BranchesTreeProvider } from './tree/branches-tree';
import type { ChangeItem, GitRepositoryService } from './git-repository-service';
import type { LogNode } from './tree/log-tree';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * 注册经 git CLI 补齐的操作（M5' batch 1）：cherry-pick / revert / reset / branch rename /
 * ignore / compare branches / reword。均经 `service.execGit`（复用 vscode.git 的同一 git 二进制）。
 */
export function registerGitCliCommands(service: GitRepositoryService, branchesTree: BranchesTreeProvider): vscode.Disposable[] {
	const subs: vscode.Disposable[] = [];

	subs.push(
		vscode.commands.registerCommand('hyperGit.cherryPick', async (node?: LogNode) => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const hash = node?.kind === 'commit' ? node.commit.hash : await pickCommitHash(service);
			if (!hash) {
				return;
			}
			try {
				await service.execGit(['cherry-pick', hash]);
				void vscode.window.showInformationMessage(`Cherry-pick ${hash.slice(0, 7)} 完成`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Cherry-pick 失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.revertCommit', async (node?: LogNode) => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const hash = node?.kind === 'commit' ? node.commit.hash : await pickCommitHash(service);
			if (!hash) {
				return;
			}
			try {
				await service.execGit(['revert', '--no-edit', hash]);
				void vscode.window.showInformationMessage(`Revert ${hash.slice(0, 7)} 完成`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Revert 失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.resetHead', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const items = [
				{ label: 'soft', description: '保留工作区与暂存区改动' },
				{ label: 'mixed', description: '保留工作区改动，取消暂存（默认）' },
				{ label: 'hard', description: '⚠ 丢弃所有改动（不可撤销）' },
				{ label: 'keep', description: '保留工作区已修改文件' },
			];
			const pick = await vscode.window.showQuickPick(items, { placeHolder: '选择 reset 模式（作用于 HEAD）' });
			if (!pick) {
				return;
			}
			if (pick.label === 'hard') {
				const ok = await vscode.window.showWarningMessage('hard reset 将丢弃所有改动，确认？', { modal: true }, '确认 hard reset');
				if (!ok) {
					return;
				}
			}
			try {
				await service.execGit(['reset', `--${pick.label}`, 'HEAD~0']);
				branchesTree.refresh();
				void vscode.window.showInformationMessage(`Reset (--${pick.label}) 完成`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Reset 失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.branchRename', async (node?: BranchNode) => {
			const repo = service.repo;
			if (!repo || node?.kind !== 'branch') {
				return;
			}
			const oldName = node.ref.name ?? '';
			const newName = await vscode.window.showInputBox({ prompt: `重命名分支「${oldName}」`, value: oldName });
			if (!newName || !newName.trim() || newName === oldName) {
				return;
			}
			try {
				await service.execGit(['branch', '-m', oldName, newName.trim()]);
				branchesTree.refresh();
			} catch (e) {
				void vscode.window.showErrorMessage(`重命名失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.ignorePath', async (change?: ChangeItem) => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const rel = change?.relativePath ?? (await pickRelativePath(service));
			if (!rel) {
				return;
			}
			const ignoreFile = path.join(repo.rootUri.fsPath, '.gitignore');
			try {
				await new Promise<void>((resolve, reject) => {
					fs.appendFile(ignoreFile, `${rel}\n`, (err) => (err ? reject(err) : resolve()));
				});
				void vscode.window.showInformationMessage(`已添加到 .gitignore：${rel}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Ignore 失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.compareBranches', async (node?: BranchNode) => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const refs = repo.state.refs.filter((r) => r.name && (r.type === 0 || r.type === 1));
			const base = node?.kind === 'branch' ? node.ref.name : await vscode.window.showQuickPick(refs.map((r) => r.name!), { placeHolder: '选择 base 分支' });
			if (!base) {
				return;
			}
			const target = await vscode.window.showQuickPick(
				refs.filter((r) => r.name !== base).map((r) => r.name!),
				{ placeHolder: `比较 ${base} 与...` },
			);
			if (!target) {
				return;
			}
			try {
				const out = await service.execGit(['diff', '--stat', `${base}...${target}`]);
				const doc = await vscode.workspace.openTextDocument({ content: `$ git diff --stat ${base}...${target}\n\n${out}`, language: 'plaintext' });
				await vscode.window.showTextDocument(doc, { preview: true });
			} catch (e) {
				void vscode.window.showErrorMessage(`比较失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.rewordCommit', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const message = await vscode.window.showInputBox({ prompt: '改写最新提交信息（amend）', value: (await repo.log({ maxEntries: 1 }))[0]?.message ?? '' });
			if (!message || !message.trim()) {
				return;
			}
			try {
				await repo.commit(message.trim(), { amend: true });
				void vscode.window.showInformationMessage('已改写最新提交');
			} catch (e) {
				void vscode.window.showErrorMessage(`改写失败：${errMsg(e)}`);
			}
		}),
	);

	return subs;
}

async function pickCommitHash(service: GitRepositoryService): Promise<string | undefined> {
	const repo = service.repo;
	if (!repo) {
		return undefined;
	}
	const commits = await repo.log({ maxEntries: 30 });
	const items = commits.map((c) => ({
		label: (c.message.split('\n', 1)[0] ?? c.hash).slice(0, 50),
		description: `${c.authorName ?? ''} · ${c.hash.slice(0, 7)}`,
		hash: c.hash,
	}));
	const pick = await vscode.window.showQuickPick(items, { placeHolder: '选择 commit' });
	return pick?.hash;
}

async function pickRelativePath(service: GitRepositoryService): Promise<string | undefined> {
	const changes = service.getChanges();
	if (changes.length === 0) {
		return undefined;
	}
	const pick = await vscode.window.showQuickPick(changes.map((c) => ({ label: c.relativePath })), { placeHolder: '选择要忽略的文件' });
	return pick?.label;
}
