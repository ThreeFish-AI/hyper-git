import { describe, it, expect } from 'vitest';
import {
	filterMergeable,
	formatBranchDeleteConfirm,
	isProtectedBranch,
	parseMergedBranchNames,
	partitionByMerged,
	PROTECTED_BRANCHES,
	truncateNames,
} from '../../src/engine/ref/cleanup';

describe('cleanup', () => {
	it('PROTECTED_BRANCHES 含 main/master', () => {
		expect(PROTECTED_BRANCHES).toContain('main');
		expect(PROTECTED_BRANCHES).toContain('master');
	});

	it('isProtectedBranch 判定默认集 + 额外排除', () => {
		expect(isProtectedBranch('main')).toBe(true);
		expect(isProtectedBranch('master')).toBe(true);
		expect(isProtectedBranch('feature')).toBe(false);
		expect(isProtectedBranch('feature', ['feature'])).toBe(true);
	});

	it('filterMergeable 解析 --merged 输出，去除 * 前缀与空行', () => {
		const out = '  main\n* feature\n  old-branch\n\n';
		// base=main → 排除 main(受保护+base)，保留 feature / old-branch
		expect(filterMergeable(out, 'main')).toEqual(['feature', 'old-branch']);
	});

	it('排除 base 与额外项（如当前 HEAD）', () => {
		const out = '  main\n  current\n  stale\n';
		expect(filterMergeable(out, 'main', ['current'])).toEqual(['stale']);
	});

	it('去重重复行', () => {
		const out = '  dup\n  dup\n  ok\n';
		expect(filterMergeable(out, 'main')).toEqual(['dup', 'ok']);
	});

	it('parseMergedBranchNames 剥离 * 前缀、去空行、去重保序（不做受保护排除）', () => {
		const out = '* main\n  feature\n\n  main\n  feature\n';
		expect(parseMergedBranchNames(out)).toEqual(['main', 'feature']);
	});
});

describe('partitionByMerged', () => {
	it('按 --merged 集合把选区分桶为 merged / unmerged', () => {
		const mergedOut = '* main\n  feat-a\n  feat-b\n';
		const { merged, unmerged } = partitionByMerged(mergedOut, ['feat-a', 'feat-c', 'feat-b', 'feat-d']);
		expect(merged).toEqual(['feat-a', 'feat-b']);
		expect(unmerged).toEqual(['feat-c', 'feat-d']);
	});

	it('全部已合并 / 全部未合并 / 空选区', () => {
		const out = '  a\n  b\n';
		expect(partitionByMerged(out, ['a', 'b'])).toEqual({ merged: ['a', 'b'], unmerged: [] });
		expect(partitionByMerged(out, ['x', 'y'])).toEqual({ merged: [], unmerged: ['x', 'y'] });
		expect(partitionByMerged('', [])).toEqual({ merged: [], unmerged: [] });
	});

	it('查询失败（空输出）时选区全部归为 unmerged', () => {
		expect(partitionByMerged('', ['a', 'b'])).toEqual({ merged: [], unmerged: ['a', 'b'] });
	});
});

describe('truncateNames', () => {
	it('不超过上限时全量 join', () => {
		expect(truncateNames(['a', 'b', 'c'])).toBe('a, b, c');
	});

	it('超过上限时截断并标注剩余数量', () => {
		const names = Array.from({ length: 10 }, (_, i) => `b${i}`);
		expect(truncateNames(names)).toBe('b0, b1, b2, b3, b4, b5, b6, b7 …还有 2 个');
	});
});

describe('formatBranchDeleteConfirm', () => {
	it('单个已合并 → 安全删除文案', () => {
		expect(formatBranchDeleteConfirm(['feat'], [])).toEqual({ detail: '分支「feat」已合并，可安全删除。', confirmLabel: '删除' });
	});

	it('单个未合并 → 强制删除文案', () => {
		const r = formatBranchDeleteConfirm([], ['feat']);
		expect(r.confirmLabel).toBe('强制删除');
		expect(r.detail).toContain('未合并');
	});

	it('多个全已合并 → 删除', () => {
		const r = formatBranchDeleteConfirm(['a', 'b'], []);
		expect(r.confirmLabel).toBe('删除');
		expect(r.detail).toContain('将删除 2 个已合并');
	});

	it('多个全未合并 → 强制删除并警示丢失提交', () => {
		const r = formatBranchDeleteConfirm([], ['a', 'b']);
		expect(r.confirmLabel).toBe('强制删除');
		expect(r.detail).toContain('丢失');
	});

	it('混合 → 全部删除并分栏诚实呈现', () => {
		const r = formatBranchDeleteConfirm(['a'], ['b']);
		expect(r.confirmLabel).toBe('全部删除');
		expect(r.detail).toContain('已合并');
		expect(r.detail).toContain('未合并');
	});
});
