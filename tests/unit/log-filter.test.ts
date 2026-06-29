import { describe, it, expect } from 'vitest';
import { applyClientFilters, safeRegex, type FilterableCommit, type LogClientFilter } from '../../src/engine/log/log-filter';

const D = (iso: string): Date => new Date(iso);
const C = (message: string, parents: string[], authorDate?: Date): FilterableCommit => ({ message, parents, authorDate });

const COMMITS: FilterableCommit[] = [
	C('feat: a', ['p1'], D('2026-06-01')),
	C('merge: branch', ['p1', 'p2'], D('2026-06-10')),
	C('fix: bug [urgent]', ['p1'], D('2026-06-20')),
	C('docs: readme', ['p1', 'p2', 'p3'], D('2026-07-01')),
];

describe('log-filter', () => {
	it('merge-only 仅保留 parents>1', () => {
		const f: LogClientFilter = { mergeMode: 'merge-only' };
		expect(applyClientFilters(COMMITS, f).map((c) => c.message)).toEqual(['merge: branch', 'docs: readme']);
	});

	it('no-merge 仅保留 parents<=1', () => {
		const f: LogClientFilter = { mergeMode: 'no-merge' };
		expect(applyClientFilters(COMMITS, f).map((c) => c.message)).toEqual(['feat: a', 'fix: bug [urgent]']);
	});

	it('all 不过滤', () => {
		expect(applyClientFilters(COMMITS, { mergeMode: 'all' })).toHaveLength(4);
		expect(applyClientFilters(COMMITS, {})).toHaveLength(4);
	});

	it('dateFrom 截断早于该日期的提交', () => {
		const f: LogClientFilter = { dateFrom: D('2026-06-15') };
		expect(applyClientFilters(COMMITS, f).map((c) => c.message)).toEqual(['fix: bug [urgent]', 'docs: readme']);
	});

	it('dateTo 截断晚于该日期的提交', () => {
		const f: LogClientFilter = { dateTo: D('2026-06-15') };
		expect(applyClientFilters(COMMITS, f).map((c) => c.message)).toEqual(['feat: a', 'merge: branch']);
	});

	it('dateFrom+dateTo 区间', () => {
		const f: LogClientFilter = { dateFrom: D('2026-06-05'), dateTo: D('2026-06-25') };
		expect(applyClientFilters(COMMITS, f).map((c) => c.message)).toEqual(['merge: branch', 'fix: bug [urgent]']);
	});

	it('无 authorDate 的提交在日期过滤时保留', () => {
		const commits = [C('no-date', ['p1'])];
		expect(applyClientFilters(commits, { dateFrom: D('2026-01-01') })).toHaveLength(1);
	});

	it('messageRegex 按 message 过滤', () => {
		const f: LogClientFilter = { messageRegex: /\[urgent\]/ };
		expect(applyClientFilters(COMMITS, f).map((c) => c.message)).toEqual(['fix: bug [urgent]']);
	});

	it('组合：no-merge + dateFrom + regex', () => {
		const f: LogClientFilter = { mergeMode: 'no-merge', dateFrom: D('2026-06-15'), messageRegex: /bug/ };
		expect(applyClientFilters(COMMITS, f).map((c) => c.message)).toEqual(['fix: bug [urgent]']);
	});
});

describe('safeRegex', () => {
	it('合法模式返回 RegExp', () => {
		expect(safeRegex('feat')).toEqual(/feat/);
	});
	it('空串返回 undefined', () => {
		expect(safeRegex('')).toBeUndefined();
	});
	it('非法模式返回 undefined（不抛错）', () => {
		expect(safeRegex('(')).toBeUndefined();
	});
});
