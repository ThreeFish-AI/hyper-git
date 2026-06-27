import { describe, it, expect } from 'vitest';
import { GitStatus, mapGitStatus } from '../../src/adapter/git-status-map';
import { FileStatus } from '../../src/engine/model';

describe('mapGitStatus', () => {
	it('MODIFIED / INDEX_MODIFIED → Modified', () => {
		expect(mapGitStatus(GitStatus.MODIFIED)).toBe(FileStatus.Modified);
		expect(mapGitStatus(GitStatus.INDEX_MODIFIED)).toBe(FileStatus.Modified);
	});

	it('INDEX_ADDED → Added', () => {
		expect(mapGitStatus(GitStatus.INDEX_ADDED)).toBe(FileStatus.Added);
	});

	it('UNTRACKED → Untracked', () => {
		expect(mapGitStatus(GitStatus.UNTRACKED)).toBe(FileStatus.Untracked);
	});

	it('DELETED / INDEX_DELETED → Deleted', () => {
		expect(mapGitStatus(GitStatus.DELETED)).toBe(FileStatus.Deleted);
		expect(mapGitStatus(GitStatus.INDEX_DELETED)).toBe(FileStatus.Deleted);
	});

	it('INDEX_RENAMED → Renamed', () => {
		expect(mapGitStatus(GitStatus.INDEX_RENAMED)).toBe(FileStatus.Renamed);
	});

	it('INDEX_COPIED → Copied', () => {
		expect(mapGitStatus(GitStatus.INDEX_COPIED)).toBe(FileStatus.Copied);
	});

	it('BOTH_MODIFIED → Conflict', () => {
		expect(mapGitStatus(GitStatus.BOTH_MODIFIED)).toBe(FileStatus.Conflict);
	});

	it('IGNORED → Ignored', () => {
		expect(mapGitStatus(GitStatus.IGNORED)).toBe(FileStatus.Ignored);
	});

	it('未知数值 → Modified（兜底）', () => {
		expect(mapGitStatus(999)).toBe(FileStatus.Modified);
	});

	it('全部 GitStatus 数值均映射到合法 FileStatus（无遗漏分支）', () => {
		const validStatuses = new Set(Object.values(FileStatus));
		const numericEntries = Object.entries(GitStatus).filter(([, v]) => typeof v === 'number') as Array<[string, number]>;
		expect(numericEntries.length).toBeGreaterThanOrEqual(19);
		for (const [name, val] of numericEntries) {
			const mapped = mapGitStatus(val);
			expect(validStatuses.has(mapped), `${name}(${val}) → ${mapped} 非法`).toBe(true);
		}
	});
});
