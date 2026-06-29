/**
 * Branches 多选归一化的纯逻辑（零 vscode 依赖）。
 *
 * VS Code 多选树的 `view/item/context` 命令以 `(clickedNode, selectedNodes[])` 调用：
 * 第 1 参为右键点击项，第 2 参为完整选区（仅多选时传入）。此处把"点击项 + 选区"
 * 归一化为一组满足谓词的 RawRef：
 * - 按谓词过滤并按 shortName 去重；
 * - 「点击在选区之外」陷阱：若点击项不在过滤后的选区中，则以点击项为准（手势目标优先，对齐 IDEA）。
 *
 * 适配层（src/adapter/branch-selection.ts）负责把 BranchNode 抽取为 RawRef 后委托本函数，
 * 以维持「UI → Adapter → Engine」单向依赖（engine 不反向依赖 adapter 类型）。
 */

import type { RawRef } from './for-each-ref';

/**
 * 归一化多选命令的作用目标。
 * @param clicked 右键点击项对应的 ref（无 / 非分支节点时为 undefined）
 * @param selection VS Code 传入的选区 ref 列表（单选时由适配层填 `[clicked]` 或空）
 * @param predicate 目标谓词（如本地可删 / 标签）
 * @returns 去重且满足谓词的 ref 列表
 */
export function collectBranchRefs(
	clicked: RawRef | undefined,
	selection: readonly RawRef[],
	predicate: (ref: RawRef) => boolean,
): RawRef[] {
	const filtered = dedupeByShortName(selection.filter(predicate));
	if (clicked && predicate(clicked)) {
		const inSelection = filtered.some((r) => r.shortName === clicked.shortName);
		if (!inSelection) {
			// 点击在选区之外 → 仅作用于点击项（手势目标优先）
			return [clicked];
		}
	}
	return filtered;
}

function dedupeByShortName(refs: readonly RawRef[]): RawRef[] {
	const seen = new Set<string>();
	const result: RawRef[] = [];
	for (const ref of refs) {
		if (seen.has(ref.shortName)) {
			continue;
		}
		seen.add(ref.shortName);
		result.push(ref);
	}
	return result;
}
