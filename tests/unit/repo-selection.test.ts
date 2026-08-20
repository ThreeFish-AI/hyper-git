import { describe, expect, it } from 'vitest';
import { normalizeRoot, pickRepositoryRoot } from '../../src/engine/git-state/repo-selection';

const repo = (rootPath: string) => ({ rootPath });

describe('normalizeRoot', () => {
	it('去尾分隔符', () => {
		expect(normalizeRoot('/a/b/')).toBe('/a/b');
		expect(normalizeRoot('/a/b')).toBe('/a/b');
	});

	it('空串与单分隔符原样（无尾可去）', () => {
		expect(normalizeRoot('')).toBe('');
		expect(normalizeRoot('/')).toBe('');
	});
});

describe('pickRepositoryRoot', () => {
	const a = repo('/ws/repo-a');
	const b = repo('/ws/repo-b');

	it('无仓库时返回 null', () => {
		expect(pickRepositoryRoot({ repos: [] })).toBeNull();
	});

	it('仅 repos 时回退首个（兼容旧行为）', () => {
		expect(pickRepositoryRoot({ repos: [a, b] })).toBe(a);
	});

	it('persistedRoot 命中优先恢复', () => {
		expect(pickRepositoryRoot({ repos: [a, b], persistedRoot: '/ws/repo-b' })).toBe(b);
	});

	it('persistedRoot 带尾分隔符仍命中（归一化比较）', () => {
		expect(pickRepositoryRoot({ repos: [a, b], persistedRoot: '/ws/repo-b/' })).toBe(b);
	});

	it('persistedRoot 指向不存在路径 → 回退 folder0 匹配', () => {
		expect(
			pickRepositoryRoot({ repos: [a, b], firstWorkspaceFolder: '/ws/repo-b', persistedRoot: '/gone' }),
		).toBe(b);
	});

	it('folder0 是 git root → 命中该仓库', () => {
		expect(pickRepositoryRoot({ repos: [a, b], firstWorkspaceFolder: '/ws/repo-a' })).toBe(a);
	});

	it('folder0 处于某 repo 内（非 root）→ 祖先最长匹配', () => {
		const outer = repo('/ws/monorepo');
		const inner = repo('/ws/monorepo/packages/x');
		expect(pickRepositoryRoot({ repos: [outer, inner], firstWorkspaceFolder: '/ws/monorepo/packages/x/src' })).toBe(
			inner,
		);
	});

	it('folder0 非 git root（注入 getRepository 语义命中）→ 命中', () => {
		const hit = pickRepositoryRoot({
			repos: [a, b],
			firstWorkspaceFolder: '/ws/arbitrary',
			repoForFolder: () => b,
		});
		expect(hit).toBe(b);
	});

	it('folder0 完全无 repo → 回退 repos[0]', () => {
		expect(pickRepositoryRoot({ repos: [a, b], firstWorkspaceFolder: '/nowhere' })).toBe(a);
	});

	it('persistedRoot 优先于 folder0（用户上次选择压倒默认锚点）', () => {
		expect(
			pickRepositoryRoot({ repos: [a, b], firstWorkspaceFolder: '/ws/repo-a', persistedRoot: '/ws/repo-b' }),
		).toBe(b);
	});

	it('返回引用稳定（命中即 repos 中的原对象）', () => {
		expect(pickRepositoryRoot({ repos: [a, b], persistedRoot: '/ws/repo-a' })).toBe(a);
	});
});
