import { describe, expect, it } from 'vitest';
import { shelfRepoDirName } from '../../src/engine/git-state/shelf-dir';

describe('shelfRepoDirName', () => {
	it('确定性：同 root 两次调用相同', () => {
		expect(shelfRepoDirName('/ws/repo-a')).toBe(shelfRepoDirName('/ws/repo-a'));
	});

	it('同 basename 不同父目录不碰撞（sha1 区分）', () => {
		expect(shelfRepoDirName('/a/api')).not.toBe(shelfRepoDirName('/b/api'));
	});

	it('含 hostile 字符的 basename 被清洗', () => {
		const name = shelfRepoDirName('/ws/my repo!@#');
		expect(name).toMatch(/^[a-zA-Z0-9_-]+\.[0-9a-f]{8}$/);
		expect(name.startsWith('my_repo___'.slice(0, 8))).toBe(true);
	});

	it('超长 basename 截 48 字符 + 8 位 hash 后缀', () => {
		const long = 'x'.repeat(200);
		const name = shelfRepoDirName(`/ws/${long}`);
		const base = name.split('.')[0];
		expect(base.length).toBe(48);
		expect(name).toMatch(/\.[0-9a-f]{8}$/);
	});

	it('空串 root 兜底 unnamed', () => {
		expect(shelfRepoDirName('')).toMatch(/^unnamed\.[0-9a-f]{8}$/);
	});

	it('尾分隔符与无分隔符的 root 同名（basename 相同且 hash 输入不同则区分）', () => {
		// 尾分隔符会改变 sha1 输入，属预期：调用方传 service.repoRoot（vscode.git 保证无尾分隔符）。
		expect(shelfRepoDirName('/ws/repo-a')).not.toBe(shelfRepoDirName('/ws/repo-a/'));
	});
});
