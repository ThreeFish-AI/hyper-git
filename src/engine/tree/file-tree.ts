/**
 * 扁平文件路径 → 目录树构建（纯逻辑，零 vscode 依赖）。
 *
 * 供 COMMIT / LOG 两个 webview 的「Group By Directory」形态使用：host 侧据同批扁平文件的路径
 * 数组构建 {@link FileTreeNode} 树随 payload 下发，webview 仅按 mode 渲染平铺或树形，切换零 host 往返
 * （复用 {@link ../log/graph-layout} 布局同款「host 算、webview 渲」范式，规避内联 JS 无法 import
 * engine 造成的 Split-Brain）。
 *
 * 叶子以 `fileIndex` 回指入参 `paths` 的下标（与扁平 files[] 同序），故渲染层可 `files[fileIndex]`
 * 复用既有单条渲染，且不复制条目数据（单一事实源）。排序：目录在前、文件在后，同类按名称
 * 数字感知升序，稳定（相等按插入序）。compact 折叠单目录子链（如 `a/b/c`）对齐 VS Code SCM
 * `explorer.compactFolders` 默认行为。
 */

import type { FileTreeNode } from '../../shared/protocol';

export interface BuildFileTreeOptions {
	/** 折叠单目录子链（默认 true，对齐 VS Code）。 */
	readonly compactFolders?: boolean;
}

interface MutNode {
	name: string;
	readonly dir: boolean;
	path: string;
	readonly fileIndex?: number;
	/** 仅目录：子节点（Map 保插入序，供稳定排序的相等兜底）。 */
	readonly children: Map<string, MutNode>;
}

/**
 * 将扁平路径数组构建为目录树。`paths[i]` 与调用方扁平 files[i] 同序，叶子 `fileIndex=i`。
 * 纯函数、永不抛错：非字符串项跳过，`./`/前导 `/` 归一化，空段过滤，重复路径 keep-first。
 */
export function buildFileTree(paths: readonly string[], opts?: BuildFileTreeOptions): readonly FileTreeNode[] {
	const compact = opts?.compactFolders ?? true;
	const root = new Map<string, MutNode>();
	const seen = new Set<string>();

	paths.forEach((raw, index) => {
		if (typeof raw !== 'string') {
			return;
		}
		const norm = raw.replace(/^\.\//, '').replace(/^\/+/, '');
		const segs = norm.split('/').filter((s) => s.length > 0);
		if (segs.length === 0 || seen.has(norm)) {
			return;
		}
		seen.add(norm);

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
		// 叶子与同名目录冲突时以先到者为准（正常 git 树不会出现 blob 与 tree 同名）。
		if (!level.has(leafName)) {
			level.set(leafName, { name: leafName, dir: false, path: norm, fileIndex: index, children: new Map() });
		}
	});

	return finalizeLevel(root, compact);
}

function compare(a: MutNode, b: MutNode): number {
	if (a.dir !== b.dir) {
		return a.dir ? -1 : 1;
	}
	return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

function finalizeLevel(level: Map<string, MutNode>, compact: boolean): FileTreeNode[] {
	// Array.prototype.sort 稳定（ES2019+）：相等键保持 Map 插入序。排序用折叠前的原名（按顶层段排序，对齐 VS Code）。
	return Array.from(level.values())
		.sort(compare)
		.map((n) => finalizeNode(n, compact));
}

function finalizeNode(node: MutNode, compact: boolean): FileTreeNode {
	if (!node.dir) {
		return { name: node.name, dir: false, path: node.path, fileIndex: node.fileIndex };
	}
	let name = node.name;
	let path = node.path;
	let childMap = node.children;
	if (compact) {
		// 折叠单目录子链，遇含叶子或多子的目录即停。
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
	return { name, dir: true, path, children: finalizeLevel(childMap, compact) };
}
