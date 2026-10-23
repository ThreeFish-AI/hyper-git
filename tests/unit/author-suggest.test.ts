import { describe, it, expect } from 'vitest';
import { buildAuthorListArgs, parseShortlog } from '../../src/engine/log/author-suggest';
import { scopeRefs } from '../../src/engine/log/log-query';
import { escapeBreLiteral, exactAuthorPattern } from '../../src/engine/log/log-filter';

describe('buildAuthorListArgs — shortlog 取数', () => {
	it('三 scope 引用范围与 Graph 视图一致（scopeRefs 单一事实源）', () => {
		expect(buildAuthorListArgs('all')).toEqual(['-s', '-n', '-e', '--branches', '--tags', '--remotes']);
		expect(buildAuthorListArgs('checkpointer')).toEqual(['-s', '-n', '-e', '--all']);
		// current 必须显式 HEAD：shortlog 无 rev 时非 tty 下等 stdin 会挂起
		expect(buildAuthorListArgs('current')).toEqual(['-s', '-n', '-e', 'HEAD']);
	});

	it('scopeRefs 提取后行为不变（重构护栏）', () => {
		expect(scopeRefs('all')).toEqual(['--branches', '--tags', '--remotes']);
		expect(scopeRefs('checkpointer')).toEqual(['--all']);
		expect(scopeRefs('current')).toEqual([]);
	});
});

describe('parseShortlog — 容错解析', () => {
	it('标准行（前导空格 + count<TAB>Name <email>），保留输出顺序（-n 已按数降序）', () => {
		const out = ['   96\tAurelius Huang <threefish.ai@gmail.com>', '    3\tThreeFish <a@b.com>'].join('\n');
		expect(parseShortlog(out)).toEqual([
			{ name: 'Aurelius Huang', email: 'threefish.ai@gmail.com', count: 96 },
			{ name: 'ThreeFish', email: 'a@b.com', count: 3 },
		]);
	});

	it('本仓库真实输出形态（含正则元字符作者名与 + 号邮箱）', () => {
		const out = '   36\tdependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>';
		expect(parseShortlog(out)).toEqual([{ name: 'dependabot[bot]', email: '49699333+dependabot[bot]@users.noreply.github.com', count: 36 }]);
	});

	it('坏行跳过、空输入返回空数组（空仓库/降级路径）', () => {
		expect(parseShortlog('')).toEqual([]);
		expect(parseShortlog('\n')).toEqual([]);
		expect(parseShortlog('garbage line without tab\n12\tno-email-here\n')).toEqual([]);
	});
});

describe('BRE 转义 — git --author 缺省 POSIX BRE（非 ERE）', () => {
	it('仅转义 \\ . [ * ^ $；+ ? | ( ) { 裸写（加反斜杠反成量词/分组操作符）', () => {
		expect(escapeBreLiteral('a.b[c]*^$\\d+?|({}')).toBe('a\\.b\\[c\\]\\*\\^\\$\\\\d+?|({}');
		expect(escapeBreLiteral('plain')).toBe('plain');
	});

	it('exact 身份 → 锚定全行字面 pattern（--author 匹配 Name <email> 整行）', () => {
		expect(exactAuthorPattern('Jane', 'jane@x.com')).toBe('^Jane <jane@x\\.com>$');
		expect(exactAuthorPattern('dependabot[bot]', '49699333+nx@users.noreply.github.com')).toBe(
			'^dependabot\\[bot\\] <49699333+nx@users\\.noreply\\.github\\.com>$',
		);
	});
});
