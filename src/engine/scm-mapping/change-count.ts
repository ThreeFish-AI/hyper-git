import * as path from 'path';

/**
 * 变更去重的单一事实源（Single Source of Truth）。
 *
 * `getChanges()`（构造 ChangeItem[]）与 `getChangeCount()`（仅计数）共用同一相对路径归一逻辑，
 * 杜绝双实现漂移导致「列表条目数」与「活动栏角标数」不一致。
 */

/** 仓库相对路径（posix 分隔），作为 changelist 分组与去重的稳定 key。 */
export function toRelKey(root: string, fsPath: string): string {
	return path.relative(root, fsPath).split(path.sep).join('/');
}

/**
 * 去重后的变更计数：按相对路径跨多组（index / 工作区 / 未跟踪）去重，仅返回唯一路径数。
 * 与 `getChanges().length` 严格相等，但不分配 ChangeItem 对象，供高频角标刷新走轻量路径。
 */
export function countUniqueChanges(
	root: string,
	...groups: ReadonlyArray<ReadonlyArray<{ readonly uri: { readonly fsPath: string } }>>
): number {
	const seen = new Set<string>();
	for (const group of groups) {
		for (const change of group) {
			seen.add(toRelKey(root, change.uri.fsPath));
		}
	}
	return seen.size;
}
