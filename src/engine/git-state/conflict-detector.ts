/**
 * Git 冲突状态检测（纯逻辑，零 vscode 依赖）。
 *
 * 解析 `git status --porcelain` 的未合并（unmerged）条目，并结合 `.git` 目录下的标记文件
 * 判定正在进行（ongoing）的 git 操作类型。供 adapter 在 merge/rebase/cherry-pick/revert/stash pop
 * 失败后做冲突兜底引导（解决冲突 / 中止操作），防止用户卡在半完成状态。
 */

/** 正在进行（且可能产生冲突）的 git 操作类型。 */
export type OngoingOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'none';

export interface ConflictState {
	readonly hasConflicts: boolean;
	readonly conflictedPaths: readonly string[];
	readonly ongoingOperation: OngoingOperation;
}

/** porcelain 中表示未合并（冲突）的 XY 状态码（git status 文档）。 */
const UNMERGED_STATUS = new Set(['DD', 'AU', 'UD', 'AA', 'DU', 'UA', 'UU']);

/**
 * 解析冲突状态。
 * @param gitStatusPorcelain `git status --porcelain` 输出
 * @param gitDirEntries `.git` 目录下的条目名（用于判定 ongoing 操作：
 *   MERGE_HEAD / rebase-merge / rebase-apply / CHERRY_PICK_HEAD / REVERT_HEAD）
 */
export function parseConflictState(gitStatusPorcelain: string, gitDirEntries: readonly string[]): ConflictState {
	const conflictedPaths: string[] = [];
	for (const line of gitStatusPorcelain.split('\n')) {
		if (line.length < 3) {
			continue;
		}
		const xy = line.slice(0, 2);
		if (!UNMERGED_STATUS.has(xy)) {
			continue;
		}
		// porcelain v1 行格式："XY path"（rename 为 "XY orig -> path"）；path 起始于第 4 列（index 3）
		const rest = line.slice(3);
		const raw = rest.includes(' -> ') ? rest.split(' -> ')[1] : rest;
		const cleaned = raw.trim().replace(/^"|"$/g, '');
		if (cleaned) {
			conflictedPaths.push(cleaned);
		}
	}
	const entries = new Set(gitDirEntries);
	let ongoingOperation: OngoingOperation = 'none';
	if (entries.has('MERGE_HEAD')) {
		ongoingOperation = 'merge';
	} else if (entries.has('rebase-merge') || entries.has('rebase-apply')) {
		ongoingOperation = 'rebase';
	} else if (entries.has('CHERRY_PICK_HEAD')) {
		ongoingOperation = 'cherry-pick';
	} else if (entries.has('REVERT_HEAD')) {
		ongoingOperation = 'revert';
	}
	return {
		hasConflicts: conflictedPaths.length > 0,
		conflictedPaths,
		ongoingOperation,
	};
}
