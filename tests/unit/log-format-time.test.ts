import { describe, it, expect } from 'vitest';
import { formatRelative, formatAbsolute } from '../../src/engine/log/format-time';

describe('formatRelative', () => {
	const now = Date.parse('2026-07-04T12:00:00Z');

	it('30 秒内 → just now', () => {
		expect(formatRelative('2026-07-04T11:59:40Z', now)).toBe('just now');
	});
	it('分钟级', () => {
		expect(formatRelative('2026-07-04T11:45:00Z', now)).toBe('15 min ago');
	});
	it('小时级', () => {
		expect(formatRelative('2026-07-04T09:00:00Z', now)).toBe('3 hr ago');
	});
	it('单数 day', () => {
		expect(formatRelative('2026-07-03T11:00:00Z', now)).toBe('1 day ago');
	});
	it('复数 days', () => {
		expect(formatRelative('2026-07-01T11:00:00Z', now)).toBe('3 days ago');
	});
	it('超 30 天回落本地日期（非相对短语）', () => {
		const s = formatRelative('2026-01-01T00:00:00Z', now);
		expect(s).not.toMatch(/ago|just now/);
		expect(s.length).toBeGreaterThan(0);
	});
	it('非法时间 → 空串', () => {
		expect(formatRelative('not-a-date', now)).toBe('');
	});
});

describe('formatAbsolute', () => {
	it('合法 ISO → 非空本地化串', () => {
		expect(formatAbsolute('2026-07-04T12:00:00Z').length).toBeGreaterThan(0);
	});
	it('非法时间 → 空串', () => {
		expect(formatAbsolute('')).toBe('');
		expect(formatAbsolute('nope')).toBe('');
	});
});
