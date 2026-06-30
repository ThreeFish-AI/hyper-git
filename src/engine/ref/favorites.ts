/**
 * 分支收藏（Favorites）纯逻辑（零 vscode 依赖）。
 *
 * 分支收藏（Set Favorite）能力：把常用分支标星置顶。本模块提供无状态集合运算，
 * 持久化与事件由 adapter 层的 BranchFavorites（workspaceState）承载，便于单测。
 */

/** 切换某分支的收藏态，返回新的收藏名列表（不可变，保持插入顺序）。 */
export function toggleFavorite(names: readonly string[], name: string): string[] {
	if (name.length === 0) {
		return [...names];
	}
	const set = new Set(names);
	if (set.has(name)) {
		set.delete(name);
	} else {
		set.add(name);
	}
	return [...set];
}

/** 是否已收藏。 */
export function isFavorite(names: readonly string[], name: string): boolean {
	return names.includes(name);
}
