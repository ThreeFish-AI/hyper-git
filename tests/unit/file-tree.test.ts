import { describe, it, expect } from 'vitest';
import { buildFileTree } from '../../src/engine/tree/file-tree';

describe('file-tree buildFileTree', () => {
	it('空输入返回空数组', () => {
		expect(buildFileTree([])).toEqual([]);
	});

	it('根级文件按名称升序、均为叶子且 fileIndex 正确', () => {
		const tree = buildFileTree(['b.txt', 'a.txt']);
		expect(tree).toEqual([
			{ name: 'a.txt', dir: false, path: 'a.txt', fileIndex: 1 },
			{ name: 'b.txt', dir: false, path: 'b.txt', fileIndex: 0 },
		]);
	});

	it('嵌套路径（compact 关）逐级建目录，叶子回指 fileIndex', () => {
		const tree = buildFileTree(['a/b/c.txt'], { compactFolders: false });
		expect(tree).toEqual([
			{
				name: 'a',
				dir: true,
				path: 'a',
				children: [
					{
						name: 'b',
						dir: true,
						path: 'a/b',
						children: [{ name: 'c.txt', dir: false, path: 'a/b/c.txt', fileIndex: 0 }],
					},
				],
			},
		]);
	});

	it('compact 开：单目录子链折叠为 a/b，遇叶子即停', () => {
		const tree = buildFileTree(['a/b/c.txt'], { compactFolders: true });
		expect(tree).toEqual([
			{
				name: 'a/b',
				dir: true,
				path: 'a/b',
				children: [{ name: 'c.txt', dir: false, path: 'a/b/c.txt', fileIndex: 0 }],
			},
		]);
	});

	it('compact 默认开启（不传 opts 等价 compactFolders:true）', () => {
		expect(buildFileTree(['x/y/z.txt'])).toEqual(buildFileTree(['x/y/z.txt'], { compactFolders: true }));
	});

	it('compact 不越过含叶子或多子的目录', () => {
		// a 直接含叶子 x.txt 与目录 b → 不折叠 a；b 单目录子链 c → 折叠 b/c
		const tree = buildFileTree(['a/x.txt', 'a/b/c/d.txt'], { compactFolders: true });
		expect(tree).toEqual([
			{
				name: 'a',
				dir: true,
				path: 'a',
				children: [
					{
						name: 'b/c',
						dir: true,
						path: 'a/b/c',
						children: [{ name: 'd.txt', dir: false, path: 'a/b/c/d.txt', fileIndex: 1 }],
					},
					{ name: 'x.txt', dir: false, path: 'a/x.txt', fileIndex: 0 },
				],
			},
		]);
	});

	it('目录在前、文件在后', () => {
		const tree = buildFileTree(['README.md', 'src/a.ts']);
		expect(tree.map((n) => [n.name, n.dir])).toEqual([
			['src', true],
			['README.md', false],
		]);
	});

	it('数字感知排序（file2 在 file10 之前）', () => {
		const tree = buildFileTree(['file10.txt', 'file2.txt']);
		expect(tree.map((n) => n.name)).toEqual(['file2.txt', 'file10.txt']);
	});

	it('同名文件位于不同目录 → 两个叶子、各自父目录、fileIndex 各异', () => {
		const tree = buildFileTree(['a/x.ts', 'b/x.ts'], { compactFolders: false });
		const dirA = tree.find((n) => n.name === 'a');
		const dirB = tree.find((n) => n.name === 'b');
		expect(dirA?.children?.[0]).toMatchObject({ name: 'x.ts', path: 'a/x.ts', fileIndex: 0 });
		expect(dirB?.children?.[0]).toMatchObject({ name: 'x.ts', path: 'b/x.ts', fileIndex: 1 });
	});

	it('fileIndex 在排序后仍指向原始扁平下标', () => {
		// 输入顺序：z.txt(0), a.txt(1)；输出按名排序后 a 在前，但 fileIndex 保留原下标
		const tree = buildFileTree(['z.txt', 'a.txt']);
		expect(tree.find((n) => n.name === 'a.txt')?.fileIndex).toBe(1);
		expect(tree.find((n) => n.name === 'z.txt')?.fileIndex).toBe(0);
	});

	it('根文件与目录混排：目录在前，各自内部有序', () => {
		const tree = buildFileTree(['zzz.txt', 'src/b.ts', 'src/a.ts'], { compactFolders: false });
		expect(tree.map((n) => n.name)).toEqual(['src', 'zzz.txt']);
		expect(tree[0].children?.map((c) => c.name)).toEqual(['a.ts', 'b.ts']);
	});

	it('去重：重复路径 keep-first（沿用首个 fileIndex）', () => {
		const tree = buildFileTree(['dup.txt', 'dup.txt']);
		expect(tree).toEqual([{ name: 'dup.txt', dir: false, path: 'dup.txt', fileIndex: 0 }]);
	});

	it('归一化：去除前导 ./ 与 /', () => {
		const tree = buildFileTree(['./a.txt', '/b.txt']);
		expect(tree.map((n) => n.path)).toEqual(['a.txt', 'b.txt']);
	});

	it('跳过空字符串 / 纯分隔路径', () => {
		expect(buildFileTree(['', '/', './'])).toEqual([]);
	});

	it('LOG 场景：以干净新路径建树，fileIndex 映射回展示条目', () => {
		// 传入干净路径（重命名的新路径），下标与 LogCommitFileItem[] 同序
		const cleanPaths = ['src/new.ts', 'README.md'];
		const tree = buildFileTree(cleanPaths, { compactFolders: false });
		expect(tree.map((n) => n.name)).toEqual(['src', 'README.md']);
		expect(tree.find((n) => n.name === 'src')?.children?.[0]).toMatchObject({ fileIndex: 0, path: 'src/new.ts' });
	});
});
