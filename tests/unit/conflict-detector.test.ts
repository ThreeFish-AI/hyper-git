import { describe, it, expect } from 'vitest';
import { parseConflictState } from '../../src/engine/git-state/conflict-detector';

describe('parseConflictState', () => {
	it('无冲突时 hasConflicts=false', () => {
		const s = parseConflictState(' M modified.txt\n?? untracked.txt\n', []);
		expect(s.hasConflicts).toBe(false);
		expect(s.conflictedPaths).toEqual([]);
		expect(s.ongoingOperation).toBe('none');
	});

	it('识别 UU/AA/DD 等未合并状态为冲突', () => {
		const s = parseConflictState('UU both.txt\nAA added.txt\nDD deleted.txt\n M ok.txt\n', []);
		expect(s.hasConflicts).toBe(true);
		expect(s.conflictedPaths).toEqual(['both.txt', 'added.txt', 'deleted.txt']);
	});

	it('忽略非冲突状态（M / A / ? 等）', () => {
		const s = parseConflictState(' M a.txt\nA  b.txt\n?? c.txt\n', []);
		expect(s.hasConflicts).toBe(false);
	});

	it('解析 rename 冲突的最终路径（orig -> new）', () => {
		const s = parseConflictState('UU old.txt -> new.txt\n', []);
		expect(s.conflictedPaths).toEqual(['new.txt']);
	});

	it('去除路径两侧引号（含空格文件名）', () => {
		const s = parseConflictState('UU "my file.txt"\n', []);
		expect(s.conflictedPaths).toEqual(['my file.txt']);
	});

	it('忽略空行与过短行', () => {
		const s = parseConflictState('\nUU a.txt\n\nx\n', []);
		expect(s.conflictedPaths).toEqual(['a.txt']);
	});

	it('MERGE_HEAD → ongoing=merge', () => {
		expect(parseConflictState('UU a.txt', ['HEAD', 'MERGE_HEAD']).ongoingOperation).toBe('merge');
	});

	it('rebase-merge / rebase-apply → ongoing=rebase', () => {
		expect(parseConflictState('UU a.txt', ['rebase-merge']).ongoingOperation).toBe('rebase');
		expect(parseConflictState('UU a.txt', ['rebase-apply']).ongoingOperation).toBe('rebase');
	});

	it('CHERRY_PICK_HEAD → ongoing=cherry-pick', () => {
		expect(parseConflictState('UU a.txt', ['CHERRY_PICK_HEAD']).ongoingOperation).toBe('cherry-pick');
	});

	it('REVERT_HEAD → ongoing=revert', () => {
		expect(parseConflictState('UU a.txt', ['REVERT_HEAD']).ongoingOperation).toBe('revert');
	});

	it('有冲突文件但无 ongoing 标记 → ongoing=none（如 stash pop 冲突）', () => {
		expect(parseConflictState('UU a.txt', []).ongoingOperation).toBe('none');
		expect(parseConflictState('UU a.txt', []).hasConflicts).toBe(true);
	});
});
