import { describe, it, expect } from 'vitest';
import { getDecoration } from '../../src/engine/scm-mapping/status-decoration';
import { FileStatus } from '../../src/engine/model';

describe('status-decoration', () => {
	it('Modified → M + modifiedResourceForeground', () => {
		const d = getDecoration(FileStatus.Modified);
		expect(d.letter).toBe('M');
		expect(d.themeColor).toBe('gitDecoration.modifiedResourceForeground');
		expect(d.faded).toBeUndefined();
		expect(d.strikeThrough).toBeUndefined();
	});

	it('Deleted → strikeThrough', () => {
		expect(getDecoration(FileStatus.Deleted).strikeThrough).toBe(true);
	});

	it('Untracked / Ignored → faded', () => {
		expect(getDecoration(FileStatus.Untracked).faded).toBe(true);
		expect(getDecoration(FileStatus.Ignored).faded).toBe(true);
	});

	it('Conflict → conflictResourceForeground', () => {
		expect(getDecoration(FileStatus.Conflict).themeColor).toBe('gitDecoration.conflictResourceForeground');
	});

	it('覆盖全部 FileStatus（无 fallback）', () => {
		const all = Object.values(FileStatus).filter((v): v is FileStatus => typeof v === 'string');
		expect(all.length).toBeGreaterThanOrEqual(8);
		for (const status of all) {
			const d = getDecoration(status);
			expect(d.letter.length).toBeGreaterThan(0);
			expect(d.themeColor).toMatch(/^gitDecoration\./);
		}
	});
});
