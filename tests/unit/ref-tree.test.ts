import { describe, it, expect } from 'vitest';
import { buildRefTree, type RefTreeNode } from '../../src/engine/ref/ref-tree';
import type { RawRef } from '../../src/engine/ref/for-each-ref';

/** 构造最小 RawRef（仅填测试关心字段）。 */
function ref(shortName: string, over: Partial<RawRef> = {}): RawRef {
	return {
		refname: `refs/heads/${shortName}`,
		shortName,
		objectname: 'deadbee',
		upstream: undefined,
		ahead: undefined,
		behind: undefined,
		head: false,
		isRemote: false,
		isTag: false,
		...over,
	};
}

/** 便于断言：把树摊平为 "path:label(kind)" 结构快照。 */
function shape(nodes: readonly RefTreeNode[]): unknown {
	return nodes.map((n) =>
		n.kind === 'leaf'
			? { leaf: n.label, ref: n.ref.shortName }
			: { folder: n.label, path: n.path, count: n.count, children: shape(n.children) },
	);
}

describe('ref-tree buildRefTree', () => {
	it('空输入返回空数组', () => {
		expect(buildRefTree([])).toEqual([]);
	});

	it('无 / 的分支保持根级叶子（label 即短名）', () => {
		const tree = buildRefTree([ref('master'), ref('2022')]);
		expect(shape(tree)).toEqual([
			{ leaf: '2022', ref: '2022' },
			{ leaf: 'master', ref: 'master' },
		]);
	});

	it('单前缀单分支也成文件夹，叶子仅显示后缀', () => {
		const tree = buildRefTree([ref('feature/1.0.0')]);
		expect(shape(tree)).toEqual([
			{ folder: 'feature', path: 'feature', count: 1, children: [{ leaf: '1.0.0', ref: 'feature/1.0.0' }] },
		]);
	});

	it('同前缀多分支收拢到同一文件夹，叶子仅后缀', () => {
		const tree = buildRefTree([ref('bak/2025'), ref('bak/master-2025-07')]);
		expect(shape(tree)).toEqual([
			{
				folder: 'bak',
				path: 'bak',
				count: 2,
				children: [
					{ leaf: '2025', ref: 'bak/2025' },
					{ leaf: 'master-2025-07', ref: 'bak/master-2025-07' },
				],
			},
		]);
	});

	it('图2 Local 排序：当前 HEAD → 收藏 → 文件夹（字母序）→ 散叶（数字感知）', () => {
		const favSet = new Set(['master']);
		const tree = buildRefTree(
			[
				ref('2024-bak'),
				ref('feature/1.0.0'),
				ref('2022'),
				ref('master'),
				ref('bak/2025'),
				ref('2024'),
				ref('2026', { head: true }),
				ref('2023'),
				ref('bak/master-2025-07'),
				ref('2024-10-29'),
			],
			{ isActive: (r) => r.head, isFavorite: (r) => favSet.has(r.shortName) },
		);
		expect(tree.map((n) => (n.kind === 'folder' ? `📁${n.label}` : n.label))).toEqual([
			'2026', // active
			'master', // favorite
			'📁bak', // 文件夹优先
			'📁feature',
			'2022',
			'2023',
			'2024',
			'2024-10-29',
			'2024-bak',
		]);
	});

	it('远程整体收拢为单个 origin 文件夹，内部再嵌 feature', () => {
		const remote = (s: string): RawRef => ref(s, { isRemote: true, refname: `refs/remotes/${s}` });
		const tree = buildRefTree([remote('origin/2022'), remote('origin/feature/1.0.0'), remote('origin/master')]);
		expect(shape(tree)).toEqual([
			{
				folder: 'origin',
				path: 'origin',
				count: 3,
				children: [
					{
						folder: 'feature',
						path: 'origin/feature',
						count: 1,
						children: [{ leaf: '1.0.0', ref: 'origin/feature/1.0.0' }],
					},
					{ leaf: '2022', ref: 'origin/2022' },
					{ leaf: 'master', ref: 'origin/master' },
				],
			},
		]);
	});

	it('compact 折叠含 / 的 remote 名（myorg/repo 视觉合并为单文件夹）', () => {
		const remote = (s: string): RawRef => ref(s, { isRemote: true, refname: `refs/remotes/${s}` });
		const tree = buildRefTree([remote('myorg/repo/a'), remote('myorg/repo/b')]);
		expect(shape(tree)).toEqual([
			{
				folder: 'myorg/repo',
				path: 'myorg/repo',
				count: 2,
				children: [
					{ leaf: 'a', ref: 'myorg/repo/a' },
					{ leaf: 'b', ref: 'myorg/repo/b' },
				],
			},
		]);
	});

	it('compact 关：逐级建目录不折叠', () => {
		const tree = buildRefTree([ref('a/b/c')], { compactFolders: false });
		expect(shape(tree)).toEqual([
			{
				folder: 'a',
				path: 'a',
				count: 1,
				children: [{ folder: 'b', path: 'a/b', count: 1, children: [{ leaf: 'c', ref: 'a/b/c' }] }],
			},
		]);
	});

	it('compact 不越过含叶子或多子的目录', () => {
		// a 直接含叶子 x 与目录 b → 不折叠 a；b 单目录子链 c → 折叠 b/c
		const tree = buildRefTree([ref('a/x'), ref('a/b/c/d')]);
		expect(shape(tree)).toEqual([
			{
				folder: 'a',
				path: 'a',
				count: 2,
				children: [
					{ folder: 'b/c', path: 'a/b/c', count: 1, children: [{ leaf: 'd', ref: 'a/b/c/d' }] },
					{ leaf: 'x', ref: 'a/x' },
				],
			},
		]);
	});

	it('去重：重复短名 keep-first', () => {
		const tree = buildRefTree([ref('feature/x'), ref('feature/x')]);
		expect(shape(tree)).toEqual([
			{ folder: 'feature', path: 'feature', count: 1, children: [{ leaf: 'x', ref: 'feature/x' }] },
		]);
	});

	it('跳过空段 / 纯分隔短名', () => {
		expect(buildRefTree([ref('/'), ref('//')])).toEqual([]);
	});

	it('文件夹 count 递归统计全部后代叶子', () => {
		const tree = buildRefTree([ref('g/a/1'), ref('g/a/2'), ref('g/b/1')], { compactFolders: false });
		const g = tree[0];
		expect(g.kind === 'folder' && g.count).toBe(3);
	});
});
