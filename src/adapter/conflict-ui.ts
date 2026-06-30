import * as fs from 'fs';
import * as vscode from 'vscode';
import { parseConflictState, type OngoingOperation } from '../engine/git-state/conflict-detector';
import type { GitRepositoryService } from './git-repository-service';

/** ongoing 操作 → 对应的 `--abort` 子命令。 */
const ABORT_ARGS: Record<Exclude<OngoingOperation, 'none'>, string[]> = {
	merge: ['merge', '--abort'],
	rebase: ['rebase', '--abort'],
	'cherry-pick': ['cherry-pick', '--abort'],
	revert: ['revert', '--abort'],
};

/**
 * 操作失败后的冲突兜底引导。检测到冲突时弹出「解决冲突 / 中止操作」。
 * @returns true 表示检测到冲突并已引导（调用方无需再弹通用错误，但应刷新视图）。
 *
 * Phase 3 自绘 3-way merge editor 就绪后，「解决冲突」将直接打开编辑器；当前引导用户手动处理。
 * 无 ongoing 标记的冲突（如 stash pop）仅提示手动解决（无「中止操作」按钮）。
 */
export async function handleGitConflict(service: GitRepositoryService, opName: string): Promise<boolean> {
	const repo = service.repo;
	if (!repo) {
		return false;
	}
	try {
		const status = await service.execGit(['status', '--porcelain']);
		const gitDir = `${repo.rootUri.fsPath}/.git`;
		let entries: string[] = [];
		try {
			entries = await fs.promises.readdir(gitDir);
		} catch {
			/* .git 非 dir（worktree/裸库）或不可读 → 仅靠 status 判冲突，ongoing 退化为 none */
		}
		const state = parseConflictState(status, entries);
		if (!state.hasConflicts) {
			return false;
		}
		const op = state.ongoingOperation;
		const canAbort = op !== 'none';
		const choice = await vscode.window.showWarningMessage(
			`${opName} encountered ${state.conflictedPaths.length} conflicted file(s).`,
			{ modal: true, detail: canAbort ? `In progress: ${op}. Resolve the conflicts to continue, or abort to restore the working tree.` : 'Please resolve the conflicts manually and commit.' },
			...(canAbort ? ['Resolve conflicts', 'Abort'] : ['Got it']),
		);
		if (choice === 'Abort' && op !== 'none') {
			try {
				await service.execGit(ABORT_ARGS[op]);
				void vscode.window.showInformationMessage(`${op} aborted, working tree restored`);
			} catch {
				void vscode.window.showErrorMessage('Failed to abort, please handle manually');
			}
		} else if (choice === 'Resolve conflicts') {
			// 打开自绘 3-way merge editor（resolveConflicts 列出冲突文件供选择）
			void vscode.commands.executeCommand('hyperGit.resolveConflicts');
		}
		return true;
	} catch {
		return false;
	}
}
