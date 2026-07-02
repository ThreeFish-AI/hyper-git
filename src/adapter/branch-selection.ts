/**
 * Branches 多选命令的适配层归一化（薄包装）。
 *
 * 把 VS Code `view/item/context` 命令的 `(clickedNode, selectedNodes[])` 实参抽取为 RawRef，
 * 再委托纯逻辑 {@link collectBranchRefs} 完成谓词过滤 / 去重 / 「点击在选区之外」归一化。
 * 维持「UI → Adapter → Engine」单向依赖：BranchNode 类型仅在本适配层出现。
 */

import type { RawRef } from '../engine/ref/for-each-ref';
import { collectBranchRefs } from '../engine/ref/selection';
import type { BranchNode } from './tree/branches-tree';

/**
 * 解析多选命令的作用目标 ref 列表。
 * @param clicked 右键点击节点（第 1 实参）
 * @param selection VS Code 传入的选区节点（第 2 实参，仅多选时存在）
 * @param predicate ref 谓词（如本地可删 / 标签）
 */
export function selectedBranchRefs(
	clicked: BranchNode | undefined,
	selection: BranchNode[] | undefined,
	predicate: (ref: RawRef) => boolean,
): RawRef[] {
	const clickedRef = clicked?.kind === 'branch' ? clicked.ref : undefined;
	const selRefs = (selection ?? [])
		.filter((n): n is Extract<BranchNode, { kind: 'branch' }> => n.kind === 'branch')
		.map((n) => n.ref);
	return collectBranchRefs(clickedRef, selRefs, predicate);
}
