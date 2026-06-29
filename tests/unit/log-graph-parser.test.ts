import { describe, it, expect } from 'vitest';
import { parseGraphLog, normalizeGraphWidth, classifyGraphChar } from '../../src/engine/log/graph-parser';

const NUL = '\x00';

describe('parseGraphLog', () => {
	it('解析 commit 行（graph + hash + decorate + subject）', () => {
		const out = `*${NUL}aaa1111${NUL} (HEAD -> main)${NUL}first commit`;
		const rows = parseGraphLog(out);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toEqual({ graph: '*', hash: 'aaa1111', decorate: '(HEAD -> main)', subject: 'first commit' });
	});

	it('graph 续行（无 NUL）只含 graph', () => {
		const out = ['*' + NUL + 'aaa' + NUL + '' + NUL + 'c1', '|\\', '| *' + NUL + 'bbb' + NUL + '' + NUL + 'c2'].join('\n');
		const rows = parseGraphLog(out);
		expect(rows).toHaveLength(3);
		expect(rows[1].graph).toBe('|\\');
		expect(rows[1].hash).toBeUndefined();
		expect(rows[2].hash).toBe('bbb');
	});

	it('graph 去除尾部空白', () => {
		const out = '*   ' + NUL + 'aaa' + NUL + '' + NUL + 's';
		expect(parseGraphLog(out)[0].graph).toBe('*');
	});

	it('decorate 为空时 trim 为 undefined', () => {
		const out = '*' + NUL + 'aaa' + NUL + '   ' + NUL + 's';
		expect(parseGraphLog(out)[0].decorate).toBeUndefined();
	});

	it('跳过空行', () => {
		const out = '\n*' + NUL + 'aaa' + NUL + '' + NUL + 's\n\n';
		expect(parseGraphLog(out)).toHaveLength(1);
	});

	it('subject 含特殊字符（| / 等）原样保留', () => {
		const out = '*' + NUL + 'aaa' + NUL + '' + NUL + 'fix: a | b / c';
		expect(parseGraphLog(out)[0].subject).toBe('fix: a | b / c');
	});
});

describe('normalizeGraphWidth', () => {
	it('右填充到最大 graph 长度，保证列对齐', () => {
		const rows = parseGraphLog(['*' + NUL + 'a' + NUL + '' + NUL + 's', '| *' + NUL + 'b' + NUL + '' + NUL + 's'].join('\n'));
		const padded = normalizeGraphWidth(rows);
		expect(padded[0]).toBe('*  '); // 长度 3（max=3）
		expect(padded[1]).toBe('| *');
		expect(padded.every((g) => g.length === 3)).toBe(true);
	});
});

describe('classifyGraphChar', () => {
	it('识别各类 graph 字符', () => {
		expect(classifyGraphChar('*')).toBe('node');
		expect(classifyGraphChar('|')).toBe('vert');
		expect(classifyGraphChar('/')).toBe('slash');
		expect(classifyGraphChar('\\')).toBe('backslash');
		expect(classifyGraphChar('_')).toBe('underscore');
		expect(classifyGraphChar(' ')).toBe('blank');
		expect(classifyGraphChar('x')).toBe('blank');
	});
});
