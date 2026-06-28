import { describe, it, expect } from 'vitest';
import { FOR_EACH_REF_FORMAT, parseForEachRef, groupByKind } from '../../src/engine/ref/for-each-ref';

const NUL = '\x00';

function line(refname: string, shortName: string, sha: string, upstream: string, head: string): string {
	return [refname, shortName, sha, upstream, head].join(NUL);
}

const SAMPLE = [
	line('refs/heads/main', 'main', 'abc1234', 'origin/main', '*'),
	line('refs/heads/feature/x', 'feature/x', 'def5678', '', ' '),
	line('refs/remotes/origin/main', 'origin/main', 'abc1234', '', ' '),
	line('refs/remotes/origin/feature/x', 'origin/feature/x', 'def5678', '', ''),
	line('refs/tags/v1.0', 'v1.0', 'abc1234', '', ' '),
].join('\n');

describe('FOR_EACH_REF_FORMAT', () => {
	it('格式与解析器字段顺序严格对应（5 个 %00 分隔字段，git 运行时解释为 NUL）', () => {
		// 注意：%00 是字面文本（git 在运行时才解释为 NUL 字节），故按字面 %00 切分
		expect(FOR_EACH_REF_FORMAT.split('%00')).toHaveLength(5);
	});
});

describe('parseForEachRef', () => {
	it('解析本地/远程/tag 三类 ref，正确判定 isRemote/isTag', () => {
		const refs = parseForEachRef(SAMPLE);
		expect(refs).toHaveLength(5);
		const local = refs.filter((r) => !r.isRemote && !r.isTag);
		expect(local.map((r) => r.shortName)).toEqual(['main', 'feature/x']);
		const remote = refs.filter((r) => r.isRemote);
		expect(remote.map((r) => r.shortName)).toEqual(['origin/main', 'origin/feature/x']);
		const tags = refs.filter((r) => r.isTag);
		expect(tags.map((r) => r.shortName)).toEqual(['v1.0']);
	});

	it('解析 objectname 短 sha', () => {
		const refs = parseForEachRef(SAMPLE);
		expect(refs.find((r) => r.shortName === 'main')?.objectname).toBe('abc1234');
	});

	it('仅 `*` 行标记 head=true（空格/空均视为非 HEAD）', () => {
		const refs = parseForEachRef(SAMPLE);
		expect(refs.find((r) => r.shortName === 'main')?.head).toBe(true);
		expect(refs.find((r) => r.shortName === 'feature/x')?.head).toBe(false);
		expect(refs.find((r) => r.shortName === 'origin/feature/x')?.head).toBe(false);
	});

	it('upstream 仅本地分支有上游时为字符串，其余为 undefined', () => {
		const refs = parseForEachRef(SAMPLE);
		expect(refs.find((r) => r.shortName === 'main')?.upstream).toBe('origin/main');
		expect(refs.find((r) => r.shortName === 'feature/x')?.upstream).toBeUndefined();
		expect(refs.find((r) => r.isRemote)?.upstream).toBeUndefined();
	});

	it('忽略空行', () => {
		const out = `\n${line('refs/heads/a', 'a', '1111111', '', ' ')}\n\n`;
		expect(parseForEachRef(out)).toHaveLength(1);
	});

	it('忽略字段不足的残行', () => {
		const out = [line('refs/heads/a', 'a', '1111111', '', ' '), 'refs/heads/b\x00b'].join('\n');
		expect(parseForEachRef(out)).toHaveLength(1);
	});

	it('refname 为空时跳过', () => {
		const out = line('', '', '1111111', '', ' ');
		expect(parseForEachRef(out)).toHaveLength(0);
	});
});

describe('groupByKind', () => {
	it('按本地/远程/tag 三组划分', () => {
		const g = groupByKind(parseForEachRef(SAMPLE));
		expect(g.local).toHaveLength(2);
		expect(g.remote).toHaveLength(2);
		expect(g.tags).toHaveLength(1);
	});
});
