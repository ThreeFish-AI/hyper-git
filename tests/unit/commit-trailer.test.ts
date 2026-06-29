import { describe, it, expect } from 'vitest';
import { appendCoAuthoredBy, authorArg } from '../../src/engine/commit/trailer';

describe('appendCoAuthoredBy', () => {
	it('给单行 message 追加 trailer（带空行分隔）', () => {
		expect(appendCoAuthoredBy('feat: x', 'Alice', 'a@x.com')).toBe('feat: x\n\nCo-authored-by: Alice <a@x.com>');
	});

	it('已有 body 时正确分隔', () => {
		const msg = 'feat: x\n\nbody line';
		expect(appendCoAuthoredBy(msg, 'Bob', 'b@x.com')).toBe('feat: x\n\nbody line\n\nCo-authored-by: Bob <b@x.com>');
	});

	it('末行已是 trailer 时直接换行追加（不再加空行）', () => {
		const msg = 'feat: x\n\nSigned-off-by: C <c@x.com>';
		expect(appendCoAuthoredBy(msg, 'Alice', 'a@x.com')).toBe('feat: x\n\nSigned-off-by: C <c@x.com>\nCo-authored-by: Alice <a@x.com>');
	});

	it('重复 trailer 不重复追加', () => {
		const msg = 'feat: x\n\nCo-authored-by: Alice <a@x.com>';
		expect(appendCoAuthoredBy(msg, 'Alice', 'a@x.com')).toBe(msg);
	});

	it('空 message 直接返回 trailer', () => {
		expect(appendCoAuthoredBy('', 'Alice', 'a@x.com')).toBe('Co-authored-by: Alice <a@x.com>');
	});

	it('去除 message 尾部空白', () => {
		expect(appendCoAuthoredBy('feat: x   \n', 'Alice', 'a@x.com')).toBe('feat: x\n\nCo-authored-by: Alice <a@x.com>');
	});
});

describe('authorArg', () => {
	it('格式化 Name <email>', () => {
		expect(authorArg('Alice', 'a@x.com')).toBe('Alice <a@x.com>');
	});
});
