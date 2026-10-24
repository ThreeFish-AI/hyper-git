import { describe, it, expect } from 'vitest';
import {
	CHECKPOINT_SUBJECT_RE,
	applyClientFilters,
	hasActiveFilter,
	isCheckpointSubject,
	parsePersistedAuthors,
	parsePersistedFilter,
	safeRegex,
	serializePersistableFilter,
	type FilterableCommit,
	type LogClientFilter,
	type LogFilter,
} from '../../src/engine/log/log-filter';

const D = (iso: string): Date => new Date(iso);
const C = (message: string, parents: string[], authorDate?: Date): FilterableCommit => ({ message, parents, authorDate });

const COMMITS: FilterableCommit[] = [
	C('feat: a', ['p1'], D('2026-06-01')),
	C('merge: branch', ['p1', 'p2'], D('2026-06-10')),
	C('fix: bug [urgent]', ['p1'], D('2026-06-20')),
	C('docs: readme', ['p1', 'p2', 'p3'], D('2026-07-01')),
];

/** 含 Conductor 自动 checkpoint 提交的样本（用于 keepCheckpoint 维度测试，与 COMMITS 隔离以保护既有断言）。 */
const COMMITS_WITH_CKPT: FilterableCommit[] = [
	...COMMITS,
	C('checkpoint:session-x-turn-y-start', ['p1'], D('2026-06-05')),
	C('checkpoint:conductor-archive-uuid', ['p1'], D('2026-06-15')),
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

describe('isCheckpointSubject / CHECKPOINT_SUBJECT_RE', () => {
	it('识别 session checkpoint 起/止', () => {
		expect(isCheckpointSubject('checkpoint:session-abc-turn-def-start')).toBe(true);
		expect(isCheckpointSubject('checkpoint:session-abc-turn-def-end')).toBe(true);
	});
	it('识别 conductor-archive / conductor-getdiff', () => {
		expect(isCheckpointSubject('checkpoint:conductor-archive-uuid')).toBe(true);
		expect(isCheckpointSubject('checkpoint:conductor-getdiff')).toBe(true);
	});
	it('不误伤非 checkpoint 前缀（含正文出现 checkpoint 字样）', () => {
		expect(isCheckpointSubject('docs: checkpoint notes')).toBe(false);
		expect(isCheckpointSubject('feat: add checkpoint api')).toBe(false);
		expect(isCheckpointSubject('')).toBe(false);
	});
	it('大小写不敏感（容错 Agent 工具配置差异）', () => {
		expect(isCheckpointSubject('Checkpoint:session-x')).toBe(true);
		expect(CHECKPOINT_SUBJECT_RE.test('CHECKPOINT:foo')).toBe(true);
	});
});

describe('applyClientFilters — keepCheckpoint 维度', () => {
	it('keepCheckpoint=false 剔除 checkpoint 提交（保留正常提交）', () => {
		const out = applyClientFilters(COMMITS_WITH_CKPT, { keepCheckpoint: false }).map((c) => c.message);
		expect(out).toEqual(['feat: a', 'merge: branch', 'fix: bug [urgent]', 'docs: readme']);
	});
	it('keepCheckpoint=undefined 不过滤 checkpoint（向后兼容）', () => {
		expect(applyClientFilters(COMMITS_WITH_CKPT, {})).toHaveLength(6);
	});
	it('keepCheckpoint=true 保留 checkpoint', () => {
		expect(applyClientFilters(COMMITS_WITH_CKPT, { keepCheckpoint: true })).toHaveLength(6);
	});
	it('组合：keepCheckpoint=false + no-merge + dateFrom（顺序正交）', () => {
		const f: LogClientFilter = { keepCheckpoint: false, mergeMode: 'no-merge', dateFrom: D('2026-06-15') };
		// 剔 checkpoint(2 条) + 剔 merge(docs) + 剔早于 06-15(feat:a) → 仅 fix: bug [urgent]
		expect(applyClientFilters(COMMITS_WITH_CKPT, f).map((c) => c.message)).toEqual(['fix: bug [urgent]']);
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

describe('parsePersistedAuthors', () => {
	it('合法 exact + pattern 混合 JSON 串还原结构（round-trip）', () => {
		const terms = [
			{ kind: 'exact', name: 'ThreeFish', email: 'fish@example.com' },
			{ kind: 'pattern', pattern: '^bot' },
		] as const;
		expect(parsePersistedAuthors(JSON.stringify(terms))).toEqual(terms);
	});

	it('非字符串输入返回 undefined', () => {
		expect(parsePersistedAuthors(undefined)).toBeUndefined();
		expect(parsePersistedAuthors(42)).toBeUndefined();
		expect(parsePersistedAuthors({})).toBeUndefined();
	});

	it('空串与非法 JSON 返回 undefined', () => {
		expect(parsePersistedAuthors('')).toBeUndefined();
		expect(parsePersistedAuthors('not-json')).toBeUndefined();
	});

	it('非数组 JSON 返回 undefined', () => {
		expect(parsePersistedAuthors('{"kind":"exact"}')).toBeUndefined();
	});

	it('元素脏项剔除，仅留合法项', () => {
		const raw = JSON.stringify([
			{ kind: 'exact', name: 'A', email: 'a@x.com' },
			{ kind: 'exact', name: '', email: 'b@x.com' }, // name 空
			{ kind: 'exact', name: 'C' }, // 缺 email
			{ kind: 'pattern', pattern: '' }, // pattern 空
			{ kind: 'unknown' }, // kind 未知
			'not-an-object',
		]);
		expect(parsePersistedAuthors(raw)).toEqual([{ kind: 'exact', name: 'A', email: 'a@x.com' }]);
	});

	it('全脏 / 空数组返回 undefined（与「空选 = 不过滤」规范化一致）', () => {
		expect(parsePersistedAuthors(JSON.stringify([{ kind: 'nope' }]))).toBeUndefined();
		expect(parsePersistedAuthors('[]')).toBeUndefined();
	});
});

describe('serializePersistableFilter / parsePersistedFilter', () => {
	const FULL: LogFilter = {
		path: 'src/a.ts',
		grep: 'fix',
		mergeMode: 'no-merge',
		dateFrom: new Date('2026-01-02T03:04:05.000Z'),
		dateTo: new Date('2026-02-03T00:00:00.000Z'),
		messageRegex: '^feat:',
	};

	it('全维度 round-trip（Date 经 ISO 串往返）', () => {
		expect(parsePersistedFilter(serializePersistableFilter(FULL))).toEqual(FULL);
	});

	it('归一化：空对象、空串、mergeMode all、undefined 入参均不落盘', () => {
		expect(serializePersistableFilter({})).toBeUndefined();
		expect(serializePersistableFilter(undefined)).toBeUndefined();
		expect(serializePersistableFilter({ path: '', grep: undefined, mergeMode: 'all' })).toBeUndefined();
	});

	it('authors 不属本层：序列化忽略', () => {
		expect(serializePersistableFilter({ authors: [{ kind: 'pattern', pattern: 'x' }] })).toBeUndefined();
	});

	it('非字符串 / 非法 JSON / 非对象返回 undefined', () => {
		expect(parsePersistedFilter(undefined)).toBeUndefined();
		expect(parsePersistedFilter(42)).toBeUndefined();
		expect(parsePersistedFilter('not-json')).toBeUndefined();
		expect(parsePersistedFilter('[]')).toBeUndefined();
	});

	it('逐字段剔除脏项，仅留合法维度', () => {
		const raw = JSON.stringify({
			path: 'ok.ts',
			grep: '',
			mergeMode: 'bogus',
			dateFrom: 'not-a-date',
			dateTo: '2026-02-03T00:00:00.000Z',
			messageRegex: 7,
		});
		expect(parsePersistedFilter(raw)).toEqual({ path: 'ok.ts', dateTo: new Date('2026-02-03T00:00:00.000Z') });
	});

	it('全脏返回 undefined', () => {
		expect(parsePersistedFilter(JSON.stringify({ grep: '', mergeMode: 'x', dateFrom: 'oops' }))).toBeUndefined();
	});
});

describe('hasActiveFilter', () => {
	it('未激活口径与持久化归一化一致：undefined / 空对象 / 空串 / mergeMode all / 空 authors', () => {
		expect(hasActiveFilter(undefined)).toBe(false);
		expect(hasActiveFilter({})).toBe(false);
		expect(hasActiveFilter({ path: '', grep: undefined, mergeMode: 'all' })).toBe(false);
		expect(hasActiveFilter({ authors: [] })).toBe(false);
	});

	it('任一维度生效即激活：authors（含 pattern）/ path / mergeMode / date / regex', () => {
		expect(hasActiveFilter({ authors: [{ kind: 'pattern', pattern: 'x' }] })).toBe(true);
		expect(hasActiveFilter({ path: 'src/a.ts' })).toBe(true);
		expect(hasActiveFilter({ mergeMode: 'no-merge' })).toBe(true);
		expect(hasActiveFilter({ dateFrom: D('2026-01-01T00:00:00.000Z') })).toBe(true);
		expect(hasActiveFilter({ messageRegex: '^feat:' })).toBe(true);
	});
});
