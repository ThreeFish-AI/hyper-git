/**
 * 分支短名 → 前缀目录树构建（纯逻辑，零 vscode 依赖）。
 *
 * 供 Branches 视图「按 `/` 前缀分组」形态使用：把 `bak/2025`、`bak/master-2025-07`、
 * `feature/1.0.0` 这类含斜杠短名，按 `/` 拆段收拢为可折叠文件夹节点，叶子仅显示末段后缀
 * （如文件夹 `bak` → `2025` / `master-2025-07`）。与 {@link ../tree/file-tree.buildFileTree}
 * 是同构问题（VS Code SCM「按目录分组」范式），故沿用其「MutNode 累积 → finalize → compact」
 * 结构；差异在于：叶子携带完整 {@link RawRef}（供适配层命令定位，短名不丢），且排序为**分支感知**
 * （当前 HEAD → 收藏 → 字母序），而非文件树的纯目录优先。
 *
 * 远程名可含 `/`（fork `myorg/repo`）：本模块只做通用 `/` 拆分，`compact` 折叠会把
 * `myorg/repo` 单目录子链渲染为单个文件夹，视觉上与「remote 为一层」等价，故无需感知 remote
 * 边界（删除等正确性敏感逻辑仍走 {@link ./remote-ref.resolveRemoteBranch}）。
 */

import type { RawRef } from './for-each-ref';

/** 叶子节点：一条分支/标签，label 为末段后缀，ref 保留完整短名供命令定位。 */
export interface RefTreeLeaf {
	readonly kind: 'leaf';
	readonly label: string;
	readonly ref: RawRef;
}

/** 文件夹节点：共同前缀，path 为完整前缀（稳定展开 key），count 为其下叶子总数。 */
export interface RefTreeFolder {
	readonly kind: 'folder';
	/** 展示段：前缀名 / compact 折叠的 "a/b"。 */
	readonly label: string;
	/** 完整前缀路径（展开/折叠稳定 key）。 */
	readonly path: string;
	/** 其下（递归）叶子总数。 */
	readonly count: number;
	readonly children: readonly RefTreeNode[];
}

export type RefTreeNode = RefTreeFolder | RefTreeLeaf;

export interface BuildRefTreeOptions {
	/** 折叠单目录子链（默认 true，对齐 VS Code；正确处理含 `/` 的 remote 名）。 */
	readonly compactFolders?: boolean;
	/** 是否当前 HEAD（排序第 0 档，置顶）。 */
	readonly isActive?: (ref: RawRef) => boolean;
	/** 是否收藏（排序第 1 档，次置顶）。 */
	readonly isFavorite?: (ref: RawRef) => boolean;
}

interface MutNode {
	name: string;
	readonly dir: boolean;
	path: string;
	/** 仅叶子：对应 ref。 */
	readonly ref?: RawRef;
	/** 仅目录：子节点（Map 保插入序，供稳定排序的相等兜底）。 */
	readonly children: Map<string, MutNode>;
}

/**
 * 将分支列表按 `shortName` 的 `/` 前缀构建为目录树。
 * 纯函数、永不抛错：非法项跳过，空段过滤，重复短名 keep-first。
 */
export function buildRefTree(refs: readonly RawRef[], opts?: BuildRefTreeOptions): readonly RefTreeNode[] {
	const compact = opts?.compactFolders ?? true;
	const isActive = opts?.isActive ?? (() => false);
	const isFavorite = opts?.isFavorite ?? (() => false);
	const root = new Map<string, MutNode>();
	const seen = new Set<string>();

	for (const ref of refs) {
		const short = ref?.shortName;
		if (typeof short !== 'string') {
			continue;
		}
		const segs = short.split('/').filter((s) => s.length > 0);
		if (segs.length === 0 || seen.has(short)) {
			continue;
		}
		seen.add(short);

		let level = root;
		let acc = '';
		for (let i = 0; i < segs.length - 1; i++) {
			acc = acc ? `${acc}/${segs[i]}` : segs[i];
			let node = level.get(segs[i]);
			if (!node || !node.dir) {
				node = { name: segs[i], dir: true, path: acc, children: new Map() };
				level.set(segs[i], node);
			}
			level = node.children;
		}
		const leafName = segs[segs.length - 1];
		// 叶子与同名目录冲突时以先到者为准（正常 git ref 不会出现 D/F 冲突，如 `a` 与 `a/b`）。
		if (!level.has(leafName)) {
			level.set(leafName, { name: leafName, dir: false, path: short, ref, children: new Map() });
		}
	}

	return finalizeLevel(root, compact, isActive, isFavorite);
}

/** 单层排序：当前 HEAD → 收藏 → （同档）文件夹在前 → 名称数字感知升序，稳定（相等按插入序）。 */
function finalizeLevel(
	level: Map<string, MutNode>,
	compact: boolean,
	isActive: (ref: RawRef) => boolean,
	isFavorite: (ref: RawRef) => boolean,
): RefTreeNode[] {
	return Array.from(level.values())
		.sort((a, b) => compareNodes(a, b, isActive, isFavorite))
		.map((n) => finalizeNode(n, compact, isActive, isFavorite));
}

/** 排序档位：叶子按 active(0) / favorite(1) / 其它(2)；文件夹恒为 2（不冒泡活动态）。 */
function tierOf(node: MutNode, isActive: (ref: RawRef) => boolean, isFavorite: (ref: RawRef) => boolean): number {
	if (node.dir || !node.ref) {
		return 2;
	}
	return isActive(node.ref) ? 0 : isFavorite(node.ref) ? 1 : 2;
}

function compareNodes(
	a: MutNode,
	b: MutNode,
	isActive: (ref: RawRef) => boolean,
	isFavorite: (ref: RawRef) => boolean,
): number {
	const ta = tierOf(a, isActive, isFavorite);
	const tb = tierOf(b, isActive, isFavorite);
	if (ta !== tb) {
		return ta - tb;
	}
	// 同档内目录在前、叶子在后（对齐 VS Code 与图2：文件夹先于散叶）。用折叠前的顶层段名排序。
	if (a.dir !== b.dir) {
		return a.dir ? -1 : 1;
	}
	return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

function finalizeNode(
	node: MutNode,
	compact: boolean,
	isActive: (ref: RawRef) => boolean,
	isFavorite: (ref: RawRef) => boolean,
): RefTreeNode {
	if (!node.dir) {
		// 叶子：ref 必非空（buildRefTree 仅以 dir:false + ref 建叶）。
		return { kind: 'leaf', label: node.name, ref: node.ref as RawRef };
	}
	let name = node.name;
	let path = node.path;
	let childMap = node.children;
	if (compact) {
		// 折叠单目录子链（如 `a/b/c`），遇含叶子或多子的目录即停。
		while (childMap.size === 1) {
			const only = childMap.values().next().value as MutNode;
			if (!only.dir) {
				break;
			}
			name = `${name}/${only.name}`;
			path = only.path;
			childMap = only.children;
		}
	}
	const children = finalizeLevel(childMap, compact, isActive, isFavorite);
	return { kind: 'folder', label: name, path, count: countLeaves(children), children };
}

/** 递归统计一组节点下的叶子总数。 */
function countLeaves(nodes: readonly RefTreeNode[]): number {
	let n = 0;
	for (const node of nodes) {
		n += node.kind === 'leaf' ? 1 : node.count;
	}
	return n;
}
