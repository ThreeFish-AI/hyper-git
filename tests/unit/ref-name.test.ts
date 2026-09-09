import { describe, expect, it } from 'vitest';
import { validateRefName } from '../../src/engine/ref/ref-name';

describe('validateRefName', () => {
	it('合法名称通过（含斜杠分层）', () => {
		expect(validateRefName('feature/x')).toBeNull();
		expect(validateRefName('feature/login-page')).toBeNull();
		expect(validateRefName('v1.0.0', 'tag')).toBeNull();
		expect(validateRefName('release/1.2.3-beta.1', 'tag')).toBeNull();
		expect(validateRefName('a.b.c')).toBeNull();
	});

	it('空与空白', () => {
		expect(validateRefName('')).toBe('Name cannot be empty');
		expect(validateRefName('   ')).toBe('Name cannot be empty');
		expect(validateRefName(' foo')).toContain('whitespace');
	});

	it('前导 -（会被当作选项）', () => {
		expect(validateRefName('-x')).toContain('"-"');
	});

	it('非法字符集', () => {
		for (const bad of ['a b', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b']) {
			expect(validateRefName(bad)).toContain('cannot contain');
		}
	});

	it('.. 与 @{ 与孤立 @', () => {
		expect(validateRefName('a..b')).toContain('..');
		expect(validateRefName('a@{b')).toContain('@{');
		expect(validateRefName('@')).toContain('"@"');
	});

	it('点相关：尾点 / .lock / 组件点开头', () => {
		expect(validateRefName('a.')).toContain('"."');
		expect(validateRefName('a.lock')).toContain('.lock');
		expect(validateRefName('.hidden/x')).toContain('"."');
		expect(validateRefName('a/.b')).toContain('"."');
	});

	it('斜杠相关：首尾斜杠与 //', () => {
		expect(validateRefName('/a')).toContain('"/"');
		expect(validateRefName('a/')).toContain('"/"');
		expect(validateRefName('a//b')).toContain('"//"');
	});

	it('branch 禁 HEAD（大小写不敏感），tag 禁 #', () => {
		expect(validateRefName('HEAD', 'branch')).toContain('HEAD');
		expect(validateRefName('head', 'branch')).toContain('HEAD');
		expect(validateRefName('HEAD')).toBeNull(); // any 不受限
		expect(validateRefName('rel#1', 'tag')).toContain('"#"');
	});

	it('组件级点规则不误伤常规点号名', () => {
		expect(validateRefName('v1.0')).toBeNull();
		expect(validateRefName('a.b/c.d')).toBeNull();
	});
});
