import { describe, it, expect } from 'vitest';
import { diff3, resolveHunk, conflictCount, type MergeHunk } from '../../src/engine/merge/diff3';

const stable = (content: string[]): Extract<MergeHunk, { kind: 'stable' }> => ({ kind: 'stable', content });
const conflict = (base: string[], ours: string[], theirs: string[]): Extract<MergeHunk, { kind: 'conflict' }> => ({
	kind: 'conflict',
	base,
	ours,
	theirs,
});

describe('diff3', () => {
	it('三方完全一致 → 单 stable', () => {
		const b = ['a', 'b', 'c'];
		expect(diff3(b, ['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([stable(['a', 'b', 'c'])]);
	});

	it('仅 ours 改动 → 取 ours（无冲突）', () => {
		const b = ['a', 'b', 'c'];
		expect(diff3(b, ['a', 'B', 'c'], ['a', 'b', 'c'])).toEqual([stable(['a', 'B', 'c'])]);
	});

	it('仅 theirs 改动 → 取 theirs（无冲突）', () => {
		const b = ['a', 'b', 'c'];
		expect(diff3(b, ['a', 'b', 'c'], ['a', 'T', 'c'])).toEqual([stable(['a', 'T', 'c'])]);
	});

	it('双方相同改动 → 取任一（无冲突）', () => {
		const b = ['a', 'b', 'c'];
		expect(diff3(b, ['a', 'X', 'c'], ['a', 'X', 'c'])).toEqual([stable(['a', 'X', 'c'])]);
	});

	it('双方不同改动同一行 → 冲突', () => {
		const b = ['a', 'b', 'c'];
		const h = diff3(b, ['a', 'O', 'c'], ['a', 'T', 'c']);
		expect(h).toEqual([stable(['a']), conflict(['b'], ['O'], ['T']), stable(['c'])]);
	});

	it('ours 新增行 + theirs 改动别处 → 无冲突合并', () => {
		const b = ['a', 'b'];
		const h = diff3(b, ['a', 'X', 'b'], ['a', 'b', 'Y']);
		// ours 在 a/b 间插 X（theirs 未动该处→取 ours）；theirs 在末尾加 Y（ours 未动→取 theirs）
		expect(h).toEqual([stable(['a', 'X', 'b', 'Y'])]);
	});

	it('双方删除同一段 → 一致（取空）', () => {
		const b = ['a', 'b', 'c'];
		const h = diff3(b, ['a', 'c'], ['a', 'c']);
		expect(h).toEqual([stable(['a', 'c'])]);
	});

	it('多处冲突与一致段交替', () => {
		const b = ['a', 'b', 'c', 'd'];
		const h = diff3(b, ['a', 'O1', 'c', 'O2'], ['a', 'T1', 'c', 'T2']);
		expect(h).toEqual([stable(['a']), conflict(['b'], ['O1'], ['T1']), stable(['c']), conflict(['d'], ['O2'], ['T2'])]);
	});
});

describe('resolveHunk', () => {
	const c = conflict(['b'], ['O'], ['T']);
	it('stable 返回 content', () => {
		expect(resolveHunk(stable(['x']), 'ours')).toEqual(['x']);
	});
	it('ours', () => {
		expect(resolveHunk(c, 'ours')).toEqual(['O']);
	});
	it('theirs', () => {
		expect(resolveHunk(c, 'theirs')).toEqual(['T']);
	});
	it('both（ours + theirs）', () => {
		expect(resolveHunk(c, 'both')).toEqual(['O', 'T']);
	});
	it('base', () => {
		expect(resolveHunk(c, 'base')).toEqual(['b']);
	});
	it('manual', () => {
		expect(resolveHunk(c, 'manual', ['custom'])).toEqual(['custom']);
	});
});

describe('conflictCount', () => {
	it('统计冲突段数', () => {
		const h = diff3(['a', 'b', 'c', 'd'], ['a', 'O1', 'c', 'O2'], ['a', 'T1', 'c', 'T2']);
		expect(conflictCount(h)).toBe(2);
	});
	it('无冲突为 0', () => {
		expect(conflictCount(diff3(['a'], ['a'], ['a']))).toBe(0);
	});
});
