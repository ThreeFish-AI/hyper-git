import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { BranchNode, BranchesTreeProvider } from './tree/branches-tree';
import type { ChangeItem, GitRepositoryService } from './git-repository-service';
import type { LogFilterControl, LogNode } from './webview/log-webview';
import { handleGitConflict } from './conflict-ui';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * 注册经 git CLI 补齐的操作（M5' batch 1）：cherry-pick / revert / reset / branch rename /
 * ignore / compare branches / reword。均经 `service.execGit`（复用 vscode.git 的同一 git 二进制）。
 */
export function registerGitCliCommands(service: GitRepositoryService, branchesTree: BranchesTreeProvider, logTree: LogFilterControl): vscode.Disposable[] {
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
				branchesTree.refresh();
				logTree.refresh();
				void vscode.window.showInformationMessage(`Cherry-pick ${hash.slice(0, 7)} complete`);
			} catch (e) {
				if (!(await handleGitConflict(service, 'Cherry-pick'))) {
					void vscode.window.showErrorMessage(`Cherry-pick failed: ${errMsg(e)}`);
				}
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
				branchesTree.refresh();
				logTree.refresh();
				void vscode.window.showInformationMessage(`Revert ${hash.slice(0, 7)} complete`);
			} catch (e) {
				if (!(await handleGitConflict(service, 'Revert'))) {
					void vscode.window.showErrorMessage(`Revert failed: ${errMsg(e)}`);
				}
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.resetHead', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			// 1) 选择目标 commit（默认最近 30 条；HEAD 在前）。修复此前固定 HEAD~0 导致
			//    mixed/keep 等同 reset HEAD（仅取消暂存/丢工作区）而无法回退到历史提交的问题。
			const target = await pickResetTarget(service);
			if (!target) {
				return;
			}
			// 2) 选择 reset 模式
			const items = [
				{ label: 'soft', description: 'Move HEAD only, keep staged and working changes' },
				{ label: 'mixed', description: 'Move HEAD + unstage (default), keep working changes' },
				{ label: 'hard', description: '⚠ Move HEAD + discard all staged and working changes (irreversible)' },
				{ label: 'keep', description: 'Move HEAD + keep modified files (aborts on conflict)' },
			];
			const pick = await vscode.window.showQuickPick(items, { placeHolder: `Select reset mode (target ${target.slice(0, 7)})` });
			if (!pick) {
				return;
			}
			if (pick.label === 'hard') {
				const ok = await vscode.window.showWarningMessage('hard reset will discard all changes. Confirm?', { modal: true }, 'Confirm hard reset');
				if (!ok) {
					return;
				}
			}
			try {
				await service.execGit(['reset', `--${pick.label}`, target]);
				branchesTree.refresh();
				logTree.refresh();
				void vscode.window.showInformationMessage(`Reset (--${pick.label} ${target.slice(0, 7)}) complete`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Reset failed: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.branchRename', async (node?: BranchNode) => {
			const repo = service.repo;
			if (!repo || node?.kind !== 'branch') {
				return;
			}
			const oldName = node.ref.shortName;
			const newName = await vscode.window.showInputBox({ prompt: `Rename branch "${oldName}"`, value: oldName });
			if (!newName || !newName.trim() || newName === oldName) {
				return;
			}
			try {
				await service.execGit(['branch', '-m', oldName, newName.trim()]);
				branchesTree.refresh();
			} catch (e) {
				void vscode.window.showErrorMessage(`Rename failed: ${errMsg(e)}`);
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
				void vscode.window.showInformationMessage(`Added to .gitignore: ${rel}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Ignore failed: ${errMsg(e)}`);
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
			const base = node?.kind === 'branch' ? node.ref.shortName : await vscode.window.showQuickPick(refs.map((r) => r.name!), { placeHolder: 'Select base branch' });
			if (!base) {
				return;
			}
			const target = await vscode.window.showQuickPick(
				refs.filter((r) => r.name !== base).map((r) => r.name!),
				{ placeHolder: `Compare ${base} with...` },
			);
			if (!target) {
				return;
			}
			try {
				const out = await service.execGit(['diff', '--stat', `${base}...${target}`]);
				const doc = await vscode.workspace.openTextDocument({ content: `$ git diff --stat ${base}...${target}\n\n${out}`, language: 'plaintext' });
				await vscode.window.showTextDocument(doc, { preview: true });
			} catch (e) {
				void vscode.window.showErrorMessage(`Compare failed: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.rewordCommit', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const message = await vscode.window.showInputBox({ prompt: 'Rewrite latest commit message (amend)', value: (await repo.log({ maxEntries: 1 }))[0]?.message ?? '' });
			if (!message || !message.trim()) {
				return;
			}
			try {
				await repo.commit(message.trim(), { amend: true });
				void vscode.window.showInformationMessage('Rewrote latest commit');
			} catch (e) {
				void vscode.window.showErrorMessage(`Rewrite failed: ${errMsg(e)}`);
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
	const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select a commit' });
	return pick?.hash;
}

async function pickRelativePath(service: GitRepositoryService): Promise<string | undefined> {
	const changes = service.getChanges();
	if (changes.length === 0) {
		return undefined;
	}
	const pick = await vscode.window.showQuickPick(changes.map((c) => ({ label: c.relativePath })), { placeHolder: 'Select file to ignore' });
	return pick?.label;
}

/** 选择 reset 目标 commit（最近 30 条，HEAD 在前）。 */
async function pickResetTarget(service: GitRepositoryService): Promise<string | undefined> {
	const repo = service.repo;
	if (!repo) {
		return undefined;
	}
	const commits = await repo.log({ maxEntries: 30 });
	const items = commits.map((c, i) => ({
		label: (c.message.split('\n', 1)[0] ?? c.hash).slice(0, 60),
		description: `${c.hash.slice(0, 7)}${i === 0 ? ' · HEAD' : ''}`,
		hash: c.hash,
	}));
	const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select reset target commit' });
	return pick?.hash;
}
