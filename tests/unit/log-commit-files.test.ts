import { describe, it, expect } from 'vitest';
import { parseNameStatus, statusLabel } from '../../src/engine/log/commit-files';

describe('commit-files parseNameStatus', () => {
	it('解析 A/M/D 普通变更', () => {
		const out = 'A\tnew.txt\nM\tmod.txt\nD\tgone.txt';
		expect(parseNameStatus(out)).toEqual([
			{ status: 'A', path: 'new.txt' },
			{ status: 'M', path: 'mod.txt' },
			{ status: 'D', path: 'gone.txt' },
		]);
	});

	it('解析 rename（R100 old -> new）', () => {
		const out = 'R100\told.txt -> new.txt';
		expect(parseNameStatus(out)).toEqual([{ status: 'R100', oldPath: 'old.txt', path: 'new.txt' }]);
	});

	it('解析 copy（C90）', () => {
		const out = 'C90\tsrc.txt -> copy.txt';
		expect(parseNameStatus(out)).toEqual([{ status: 'C90', oldPath: 'src.txt', path: 'copy.txt' }]);
	});

	it('忽略空行与无 tab 的非法行', () => {
		const out = '\nA\ta.txt\nINVALIDLINE\n\nM\tb.txt';
		expect(parseNameStatus(out)).toHaveLength(2);
	});

	it('状态或路径为空时跳过', () => {
		const out = '\ta.txt\nM\t';
		expect(parseNameStatus(out)).toHaveLength(0);
	});

	it('含空格/中文路径正常解析', () => {
		expect(parseNameStatus('M\tmy file 中文.txt')).toEqual([{ status: 'M', path: 'my file 中文.txt' }]);
	});
});

describe('statusLabel', () => {
	it('R100 → R', () => {
		expect(statusLabel('R100')).toBe('R');
	});
	it('C90 → C', () => {
		expect(statusLabel('C90')).toBe('C');
	});
	it('A/M/D 原样', () => {
		expect(statusLabel('A')).toBe('A');
		expect(statusLabel('M')).toBe('M');
	});
});
