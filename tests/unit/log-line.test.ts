import { describe, it, expect } from 'vitest';
import { parseLogLines, LOG_GRAPH_FORMAT } from '../../src/engine/log/log-line';

const NUL = '\x00';
const RS = '\x1e';

/** 模拟 git 逐 commit 输出：字段 NUL 分隔、记录以 RS 终止、git 追加一个换行。 */
const rec = (
	hash: string,
	parents: string,
	an: string,
	ae: string,
	aI: string,
	cn: string,
	cI: string,
	subject: string,
	body: string,
): string => `${hash}${NUL}${parents}${NUL}${an}${NUL}${ae}${NUL}${aI}${NUL}${cn}${NUL}${cI}${NUL}${subject}${NUL}${body}${RS}\n`;

const AI = '2026-06-29T10:00:00+08:00';

describe('LOG_GRAPH_FORMAT', () => {
	it('字段顺序：H P an ae aI cn cI s b（body 置末），以 NUL 分隔、RS 终止', () => {
		expect(LOG_GRAPH_FORMAT).toBe('%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%cI%x00%s%x00%b%x1e');
	});
});

describe('parseLogLines', () => {
	it('解析单条 commit', () => {
		const rows = parseLogLines(rec('aaa', 'bbb', 'Jane', 'j@x.io', AI, 'Jane', AI, 'fix: bug', 'detail line'));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toEqual({
			hash: 'aaa',
			parents: ['bbb'],
			authorName: 'Jane',
			authorEmail: 'j@x.io',
			authorDate: AI,
			committerName: 'Jane',
			committerDate: AI,
			subject: 'fix: bug',
			body: 'detail line',
		});
	});

	it('解析多条（第二条带 git 行首换行）', () => {
		const out = rec('aaa', 'bbb', 'A', 'a@x', AI, 'A', AI, 's1', '') + rec('bbb', '', 'B', 'b@x', AI, 'B', AI, 's2', '');
		const rows = parseLogLines(out);
		expect(rows).toHaveLength(2);
		expect(rows[1].hash).toBe('bbb');
		expect(rows[1].subject).toBe('s2');
	});

	it('root 提交：parents 为空数组', () => {
		const rows = parseLogLines(rec('aaa', '', 'A', 'a@x', AI, 'A', AI, 'init', ''));
		expect(rows[0].parents).toEqual([]);
	});

	it('多父（merge）：parents 按空格拆分', () => {
		const rows = parseLogLines(rec('m', 'p1 p2 p3', 'A', 'a@x', AI, 'A', AI, 'merge', ''));
		expect(rows[0].parents).toEqual(['p1', 'p2', 'p3']);
	});

	it('空输出返回空数组', () => {
		expect(parseLogLines('')).toEqual([]);
	});

	it('字段不足的记录被跳过（不中断整体解析）', () => {
		const bad = `only${NUL}two${RS}\n`;
		const good = rec('aaa', '', 'A', 'a@x', AI, 'A', AI, 's', '');
		const rows = parseLogLines(bad + good);
		expect(rows).toHaveLength(1);
		expect(rows[0].hash).toBe('aaa');
	});

	it('subject 含特殊字符（| / \\）原样保留', () => {
		const rows = parseLogLines(rec('aaa', '', 'A', 'a@x', AI, 'A', AI, 'fix: a | b / c \\ d', ''));
		expect(rows[0].subject).toBe('fix: a | b / c \\ d');
	});

	it('多行正文原样保留（含空行）', () => {
		const body = 'line1\n\nline3 with | and \\ chars';
		const rows = parseLogLines(rec('aaa', '', 'A', 'a@x', AI, 'A', AI, 'feat: x', body));
		expect(rows[0].body).toBe(body);
	});

	it('空正文 → body 为空字符串', () => {
		const rows = parseLogLines(rec('aaa', '', 'A', 'a@x', AI, 'A', AI, 'chore: y', ''));
		expect(rows[0].body).toBe('');
	});

	it('提交者与作者不同：分别解析', () => {
		const rows = parseLogLines(rec('aaa', '', 'Author', 'a@x', AI, 'Committer', '2026-07-01T09:00:00+08:00', 's', ''));
		expect(rows[0].authorName).toBe('Author');
		expect(rows[0].committerName).toBe('Committer');
		expect(rows[0].committerDate).toBe('2026-07-01T09:00:00+08:00');
	});
});
