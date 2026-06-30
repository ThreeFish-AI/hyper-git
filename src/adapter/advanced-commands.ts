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
			const ok = await vscode.window.showWarningMessage('撤销最近一次提交（soft reset，保留改动到暂存区）？', { modal: true }, '撤销');
			if (ok !== '撤销') {
				return;
			}
			try {
				await service.execGit(['reset', '--soft', 'HEAD~1']);
				branchesTree.refresh();
				void vscode.window.showInformationMessage('已撤销最近提交（soft）');
			} catch (e) {
				void vscode.window.showErrorMessage(`撤销失败：${errMsg(e)}`);
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
				`删除提交 ${hash.slice(0, 7)}？将用 rebase 重写历史（可能冲突；已推送的提交勿用）。`,
				{ modal: true },
				'删除提交',
			);
			if (ok !== '删除提交') {
				return;
			}
			try {
				await service.execGit(['rebase', '--onto', `${hash}^`, hash]);
				branchesTree.refresh();
				void vscode.window.showInformationMessage(`已删除提交 ${hash.slice(0, 7)}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`删除失败（可能需手动解冲突）：${errMsg(e)}`);
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
				`将当前已暂存改动 fixup 到 ${hash.slice(0, 7)}？将重写历史（autosquash rebase）。`,
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
				void vscode.window.showInformationMessage(`已 fixup 到 ${hash.slice(0, 7)}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Fixup 失败：${errMsg(e)}`);
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
				void vscode.window.showErrorMessage(`查询已合并分支失败：${errMsg(e)}`);
				return;
			}
			if (merged.length === 0) {
				void vscode.window.showInformationMessage('无可清理的已合并分支');
				return;
			}
			const picks = await vscode.window.showQuickPick(
				merged.map((b) => ({ label: b, picked: true })),
				{ canPickMany: true, title: `已合并到 ${base} 的本地分支（勾选删除）` },
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
			void vscode.window.showInformationMessage(`已删除 ${deleted} 个已合并分支`);
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
			void vscode.window.showInformationMessage(names.length === 1 ? `已复制 ${names[0]}` : `已复制 ${names.length} 个引用`);
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
					'# 3-way Diff 概览（HEAD ↔ Staged ↔ Working）',
					'',
					'## 已暂存改动（HEAD ↔ Staged）',
					'',
					staged.trim() || '_(无)_)',
					'',
					'## 未暂存改动（Staged ↔ Working）',
					'',
					working.trim() || '_(无)_',
					'',
				].join('\n');
				const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
				await vscode.window.showTextDocument(doc, { preview: true });
			} catch (e) {
				void vscode.window.showErrorMessage(`3-way diff 失败：${errMsg(e)}`);
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
