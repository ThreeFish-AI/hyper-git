import * as vscode from 'vscode';
import type { BranchNode, BranchesTreeProvider } from './tree/branches-tree';
import type { GitRepositoryService } from './git-repository-service';
import type { LogNode } from './webview/log-webview';
import { filterMergeable } from '../engine/ref/cleanup';
import { selectedBranchRefs } from './branch-selection';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * 注册高级 git 操作（Batch 3）—— Log/Branches 的高级动作。
 * undo commit（soft reset）/ drop commit（rebase --onto）/ fixup（autosquash，经 env 注入 GIT_SEQUENCE_EDITOR）
 * / cleanup branches（--merged 批量删）/ copy branch ref / 3-way diff 概览。
 */
export function registerAdvancedCommands(service: GitRepositoryService, branchesTree: BranchesTreeProvider): vscode.Disposable[] {
	const subs: vscode.Disposable[] = [];

	subs.push(
		vscode.commands.registerCommand('hyperGit.undoLastCommit', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const ok = await vscode.window.showWarningMessage('Undo the last commit (soft reset, keeps changes in the index)?', { modal: true }, 'Undo');
			if (ok !== 'Undo') {
				return;
			}
			try {
				await service.execGit(['reset', '--soft', 'HEAD~1']);
				branchesTree.refresh();
				void vscode.window.showInformationMessage('Undo last commit complete (soft)');
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to undo: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.dropCommit', async (node?: LogNode) => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const hash = node?.kind === 'commit' ? node.commit.hash : await pickCommitHash(service);
			if (!hash) {
				return;
			}
			const ok = await vscode.window.showWarningMessage(
				`Drop commit ${hash.slice(0, 7)}? This rewrites history via rebase (may conflict; do not use on pushed commits).`,
				{ modal: true },
				'Drop commit',
			);
			if (ok !== 'Drop commit') {
				return;
			}
			try {
				await service.execGit(['rebase', '--onto', `${hash}^`, hash]);
				branchesTree.refresh();
				void vscode.window.showInformationMessage(`Dropped commit ${hash.slice(0, 7)}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to drop (may need manual conflict resolution): ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.fixupCommit', async (node?: LogNode) => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const hash = node?.kind === 'commit' ? node.commit.hash : await pickCommitHash(service);
			if (!hash) {
				return;
			}
			const ok = await vscode.window.showWarningMessage(
				`Fixup the currently staged changes into ${hash.slice(0, 7)}? This rewrites history (autosquash rebase).`,
				{ modal: true },
				'Fixup',
			);
			if (ok !== 'Fixup') {
				return;
			}
			try {
				await service.execGit(['commit', `--fixup=${hash}`]);
				await service.execGit(['rebase', '-i', '--autosquash', `${hash}^`], {
					env: { ...process.env, GIT_SEQUENCE_EDITOR: ':' },
				});
				branchesTree.refresh();
				void vscode.window.showInformationMessage(`Fixup into ${hash.slice(0, 7)} complete`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Fixup failed: ${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.cleanupBranches', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const headName = repo.state.HEAD?.name;
			const base = headName ?? 'main';
			let merged: string[] = [];
			try {
				const out = await service.execGit(['branch', '--merged', base]);
				merged = filterMergeable(out, base, headName ? [headName] : []);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to query merged branches: ${errMsg(e)}`);
				return;
			}
			if (merged.length === 0) {
				void vscode.window.showInformationMessage('No merged branches to clean up');
				return;
			}
			const picks = await vscode.window.showQuickPick(
				merged.map((b) => ({ label: b, picked: true })),
				{ canPickMany: true, title: `Local branches merged into ${base} (check to delete)` },
			);
			if (!picks || picks.length === 0) {
				return;
			}
			let deleted = 0;
			for (const p of picks) {
				try {
					await service.execGit(['branch', '-d', p.label]);
					deleted++;
				} catch {
					/* 跳过删除失败的分支（如未完全合并） */
				}
			}
			branchesTree.refresh();
			void vscode.window.showInformationMessage(`Deleted ${deleted} merged branch(es)`);
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.copyBranchRef', async (node?: BranchNode, nodes?: BranchNode[]) => {
			// 支持多选：复制全部选中引用（按行连接）。
			const names = selectedBranchRefs(node, nodes, () => true)
				.map((r) => r.shortName)
				.filter((n) => n.length > 0);
			if (names.length === 0) {
				return;
			}
			await vscode.env.clipboard.writeText(names.join('\n'));
			void vscode.window.showInformationMessage(names.length === 1 ? `Copied ${names[0]}` : `Copied ${names.length} refs`);
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.threeWayDiff', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			try {
				const staged = await service.execGit(['diff', '--cached', '--stat']);
				const working = await service.execGit(['diff', '--stat']);
				const content = [
					'# 3-way Diff Overview (HEAD ↔ Staged ↔ Working)',
					'',
					'## Staged Changes (HEAD ↔ Staged)',
					'',
					staged.trim() || '_(none)_)',
					'',
					'## Unstaged Changes (Staged ↔ Working)',
					'',
					working.trim() || '_(none)_',
					'',
				].join('\n');
				const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
				await vscode.window.showTextDocument(doc, { preview: true });
			} catch (e) {
				void vscode.window.showErrorMessage(`3-way diff failed: ${errMsg(e)}`);
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
