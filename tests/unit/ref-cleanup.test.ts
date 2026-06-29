import { describe, it, expect } from 'vitest';
import { filterMergeable, isProtectedBranch, PROTECTED_BRANCHES } from '../../src/engine/ref/cleanup';

describe('cleanup', () => {
	it('PROTECTED_BRANCHES 含 main/master', () => {
		expect(PROTECTED_BRANCHES).toContain('main');
		expect(PROTECTED_BRANCHES).toContain('master');
	});

	it('isProtectedBranch 判定默认集 + 额外排除', () => {
		expect(isProtectedBranch('main')).toBe(true);
		expect(isProtectedBranch('master')).toBe(true);
		expect(isProtectedBranch('feature')).toBe(false);
		expect(isProtectedBranch('feature', ['feature'])).toBe(true);
	});

	it('filterMergeable 解析 --merged 输出，去除 * 前缀与空行', () => {
		const out = '  main\n* feature\n  old-branch\n\n';
		// base=main → 排除 main(受保护+base)，保留 feature / old-branch
		expect(filterMergeable(out, 'main')).toEqual(['feature', 'old-branch']);
	});

	it('排除 base 与额外项（如当前 HEAD）', () => {
		const out = '  main\n  current\n  stale\n';
		expect(filterMergeable(out, 'main', ['current'])).toEqual(['stale']);
	});

	it('去重重复行', () => {
		const out = '  dup\n  dup\n  ok\n';
		expect(filterMergeable(out, 'main')).toEqual(['dup', 'ok']);
	});
});
