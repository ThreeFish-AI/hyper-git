import { describe, it, expect } from 'vitest';
import { diffShapeFromStatus, diffShapeFromCode } from '../../src/engine/diff/change-side';
import { FileStatus } from '../../src/engine/model';

describe('diffShapeFromStatus（Commit 视图领域模型状态 → 差异形态）', () => {
	it('新增类（Added/Untracked/Copied）→ added（旧端置空）', () => {
		expect(diffShapeFromStatus(FileStatus.Added)).toBe('added');
		expect(diffShapeFromStatus(FileStatus.Untracked)).toBe('added');
		expect(diffShapeFromStatus(FileStatus.Copied)).toBe('added');
	});

	it('Deleted → deleted（新端置空）', () => {
		expect(diffShapeFromStatus(FileStatus.Deleted)).toBe('deleted');
	});

	it('Renamed → renamed（两端异路径）', () => {
		expect(diffShapeFromStatus(FileStatus.Renamed)).toBe('renamed');
	});

	it('其余（Modified/Conflict/Ignored）→ modified（两端同路径真实内容）', () => {
		expect(diffShapeFromStatus(FileStatus.Modified)).toBe('modified');
		expect(diffShapeFromStatus(FileStatus.Conflict)).toBe('modified');
		expect(diffShapeFromStatus(FileStatus.Ignored)).toBe('modified');
	});
});

describe('diffShapeFromCode（Graph 视图 git diff-tree 字母码 → 差异形态）', () => {
	it('A/U → added', () => {
		expect(diffShapeFromCode('A')).toBe('added');
		expect(diffShapeFromCode('U')).toBe('added');
	});

	it('D → deleted', () => {
		expect(diffShapeFromCode('D')).toBe('deleted');
	});

	it('R/C（含相似度后缀 R100/C90）→ renamed', () => {
		expect(diffShapeFromCode('R')).toBe('renamed');
		expect(diffShapeFromCode('R100')).toBe('renamed');
		expect(diffShapeFromCode('C')).toBe('renamed');
		expect(diffShapeFromCode('C90')).toBe('renamed');
	});

	it('M/T 及未知码 → modified（默认回落）', () => {
		expect(diffShapeFromCode('M')).toBe('modified');
		expect(diffShapeFromCode('T')).toBe('modified');
		expect(diffShapeFromCode('X')).toBe('modified');
	});
});
