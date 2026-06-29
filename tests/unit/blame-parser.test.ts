import { describe, it, expect } from 'vitest';
import { parseBlamePorcelain, formatAnnotation } from '../../src/engine/blame/blame-parser';

// 模拟 git blame --line-porcelain（两行，第二行复用首个 commit 的元数据缓存）
const SAMPLE = [
	'abc1234567 1 1 2',
	'author Alice',
	'author-mail <a@x.com>',
	'author-time 1700000000',
	'author-tz +0800',
	'summary feat: first',
	'filename f.txt',
	'\tline one content',
	'abc1234567 2 2',
	'\tline two content',
	'def8901234 3 3 1',
	'author Bob',
	'author-time 1710000000',
	'summary fix: third',
	'filename f.txt',
	'\tline three content',
].join('\n');

describe('parseBlamePorcelain', () => {
	it('解析每个最终行号 → BlameLine', () => {
		const lines = parseBlamePorcelain(SAMPLE);
		expect(lines).toHaveLength(3);
		expect(lines.map((l) => l.line)).toEqual([1, 2, 3]);
	});

	it('首块解析 author/time/summary', () => {
		const l = parseBlamePorcelain(SAMPLE)[0];
		expect(l.sha).toBe('abc1234567');
		expect(l.author).toBe('Alice');
		expect(l.authorTime).toBe(1700000000);
		expect(l.summary).toBe('feat: first');
	});

	it('同 commit 后续块复用元数据缓存（省略 author）', () => {
		const l = parseBlamePorcelain(SAMPLE)[1];
		expect(l.sha).toBe('abc1234567');
		expect(l.author).toBe('Alice'); // 来自缓存
		expect(l.summary).toBe('feat: first');
	});

	it('不同 commit 解析独立元数据', () => {
		const l = parseBlamePorcelain(SAMPLE)[2];
		expect(l.sha).toBe('def8901234');
		expect(l.author).toBe('Bob');
		expect(l.summary).toBe('fix: third');
	});

	it('空输入返回空', () => {
		expect(parseBlamePorcelain('')).toEqual([]);
	});
});

describe('formatAnnotation', () => {
	it('格式化 作者 · 日期', () => {
		const s = formatAnnotation({ line: 1, sha: 'abc1234', author: 'Alice', authorTime: 1700000000, summary: 's' });
		expect(s).toMatch(/^Alice · \d{4}-\d{2}-\d{2}$/);
	});

	it('全 0 sha → 未提交', () => {
		expect(formatAnnotation({ line: 1, sha: '0000000000', author: '', authorTime: 0, summary: '' })).toBe('未提交');
	});
});
