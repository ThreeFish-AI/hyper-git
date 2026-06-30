/**
 * Changelist 分组纯逻辑（零 vscode 依赖，可单测）。
 *
 * 参考 JetBrains `ChangeListManager` 设计：变更项（item）按 key（文件相对路径）
 * 分配到命名 changelist；未显式分配者落入 active changelist（默认行为）。
 */

export interface ChangelistDef {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
}

/** fileKey → changelistId 的分配表（持久化于 workspaceState）。 */
export type ChangelistAssignment = Record<string, string>;

export interface GroupedChangelist<T> extends ChangelistDef {
	readonly active: boolean;
	readonly items: readonly T[];
}

/**
 * 将 items 按 changelist 分组。
 *
 * @param items 变更项
 * @param keyOf 提取 item 的稳定 key（文件相对路径）
 * @param defs changelist 定义（决定输出顺序）
 * @param assignments fileKey→changelistId 分配表
 * @param activeId 当前 active changelist id（未分配项的兜底归属）
 */
export function groupByChangelist<T>(
	items: readonly T[],
	keyOf: (item: T) => string,
	defs: readonly ChangelistDef[],
	assignments: ChangelistAssignment,
	activeId: string,
): GroupedChangelist<T>[] {
	// 未分配项始终落入 active changelist（新改动默认归活动列表）。
	const fallbackId = activeId;

	const buckets = new Map<string, T[]>();
	for (const def of defs) {
		buckets.set(def.id, []);
	}
	if (!buckets.has(activeId)) {
		buckets.set(activeId, []);
	}

	for (const item of items) {
		const key = keyOf(item);
		let id = assignments[key] ?? fallbackId;
		if (!buckets.has(id)) {
			id = fallbackId;
		}
		buckets.get(id)!.push(item);
	}

	const result: GroupedChangelist<T>[] = [];
	const seen = new Set<string>();
	for (const def of defs) {
		seen.add(def.id);
		result.push({ ...def, active: def.id === activeId, items: buckets.get(def.id) ?? [] });
	}
	// 兜底：active changelist 不在 defs 中时补一项
	if (!seen.has(activeId)) {
		result.push({ id: activeId, name: activeId, active: true, items: buckets.get(activeId) ?? [] });
	}
	return result;
}
