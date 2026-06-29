import { describe, it, expect } from 'vitest';
import { parseLogLines, LOG_GRAPH_FORMAT } from '../../src/engine/log/log-line';

const NUL = '\x00';
const RS = '\x1e';

/** 模拟 git 逐 commit 输出：字段 NUL 分隔、记录以 RS 终止、git 追加一个换行。 */
const rec = (hash: string, parents: string, an: string, ae: string, aI: string, subject: string): string =>
	`${hash}${NUL}${parents}${NUL}${an}${NUL}${ae}${NUL}${aI}${NUL}${subject}${RS}\n`;

describe('LOG_GRAPH_FORMAT', () => {
	it('字段顺序：H P an ae aI s，以 NUL 分隔、RS 终止', () => {
		expect(LOG_GRAPH_FORMAT).toBe('%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x1e');
	});
});

describe('parseLogLines', () => {
	it('解析单条 commit', () => {
		const rows = parseLogLines(rec('aaa', 'bbb', 'Jane', 'j@x.io', '2026-06-29T10:00:00+08:00', 'fix: bug'));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toEqual({
			hash: 'aaa',
			parents: ['bbb'],
			authorName: 'Jane',
			authorEmail: 'j@x.io',
			authorDate: '2026-06-29T10:00:00+08:00',
			subject: 'fix: bug',
		});
	});

	it('解析多条（第二条带 git 行首换行）', () => {
		const out = rec('aaa', 'bbb', 'A', 'a@x', '2026-06-29T10:00:00+08:00', 's1') + rec('bbb', '', 'B', 'b@x', '2026-06-28T10:00:00+08:00', 's2');
		const rows = parseLogLines(out);
		expect(rows).toHaveLength(2);
		expect(rows[1].hash).toBe('bbb');
		expect(rows[1].subject).toBe('s2');
	});

	it('root 提交：parents 为空数组', () => {
		const rows = parseLogLines(rec('aaa', '', 'A', 'a@x', '2026-06-29T10:00:00+08:00', 'init'));
		expect(rows[0].parents).toEqual([]);
	});

	it('多父（merge）：parents 按空格拆分', () => {
		const rows = parseLogLines(rec('m', 'p1 p2 p3', 'A', 'a@x', '2026-06-29T10:00:00+08:00', 'merge'));
		expect(rows[0].parents).toEqual(['p1', 'p2', 'p3']);
	});

	it('空输出返回空数组', () => {
		expect(parseLogLines('')).toEqual([]);
	});

	it('字段不足的记录被跳过（不中断整体解析）', () => {
		const bad = `only${NUL}two${RS}\n`;
		const good = rec('aaa', '', 'A', 'a@x', '2026-06-29T10:00:00+08:00', 's');
		const rows = parseLogLines(bad + good);
		expect(rows).toHaveLength(1);
		expect(rows[0].hash).toBe('aaa');
	});

	it('subject 含特殊字符（| / \\）原样保留', () => {
		const rows = parseLogLines(rec('aaa', '', 'A', 'a@x', '2026-06-29T10:00:00+08:00', 'fix: a | b / c \\ d'));
		expect(rows[0].subject).toBe('fix: a | b / c \\ d');
	});
});
