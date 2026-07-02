import { describe, it, expect } from 'vitest';
import { resolveRemoteBranch, partitionRemoteByProtected, formatRemoteDeleteConfirm } from '../../src/engine/ref/remote-ref';

describe('resolveRemoteBranch', () => {
	it('普通 remote：origin/foo → {origin, foo}', () => {
		expect(resolveRemoteBranch('origin/foo', ['origin'])).toEqual({
			remote: 'origin',
			branch: 'foo',
			shortName: 'origin/foo',
		});
	});

	it('含斜杠 remote：myorg/repo/feature → {myorg/repo, feature}（最长前缀）', () => {
		expect(resolveRemoteBranch('myorg/repo/feature', ['origin', 'myorg/repo'])).toEqual({
			remote: 'myorg/repo',
			branch: 'feature',
			shortName: 'myorg/repo/feature',
		});
	});

	it('歧义优先最长前缀（同时存在 myorg 与 myorg/repo）', () => {
		expect(resolveRemoteBranch('myorg/repo/feat', ['myorg', 'myorg/repo'])?.remote).toBe('myorg/repo');
	});

	it('前缀带分隔符防误配（origin 不应匹配 originx/foo）', () => {
		expect(resolveRemoteBranch('originx/foo', ['origin'])).toBeNull();
	});

	it('分支名自身含斜杠：origin/feat/x → {origin, feat/x}', () => {
		expect(resolveRemoteBranch('origin/feat/x', ['origin'])).toEqual({
			remote: 'origin',
			branch: 'feat/x',
			shortName: 'origin/feat/x',
		});
	});

	it('不属于任何已知 remote → null', () => {
		expect(resolveRemoteBranch('upstream/foo', ['origin'])).toBeNull();
	});

	it('纯 remote 名（无分支段）→ null', () => {
		expect(resolveRemoteBranch('origin', ['origin'])).toBeNull();
	});

	it('空 remotes → null', () => {
		expect(resolveRemoteBranch('origin/foo', [])).toBeNull();
	});
});

describe('partitionRemoteByProtected', () => {
	const t = (shortName: string, remote: string, branch: string) => ({ remote, branch, shortName });

	it('main/master 归 protected，其余 deletable', () => {
		const { deletable, protectedTargets } = partitionRemoteByProtected([
			t('origin/main', 'origin', 'main'),
			t('origin/master', 'origin', 'master'),
			t('origin/feat', 'origin', 'feat'),
		]);
		expect(deletable.map((x) => x.branch)).toEqual(['feat']);
		expect(protectedTargets.map((x) => x.branch).sort()).toEqual(['main', 'master']);
	});

	it('空输入 → 两桶皆空', () => {
		const r = partitionRemoteByProtected([]);
		expect(r.deletable).toEqual([]);
		expect(r.protectedTargets).toEqual([]);
	});

	it('分支名含斜杠的受保护判定基于末段（feat/main 不受保护）', () => {
		const { deletable } = partitionRemoteByProtected([t('origin/feat/main', 'origin', 'feat/main')]);
		expect(deletable.map((x) => x.branch)).toEqual(['feat/main']);
	});
});

describe('formatRemoteDeleteConfirm', () => {
	const t = (shortName: string, remote: string, branch: string) => ({ remote, branch, shortName });

	it('单条 → 删除 + 不可撤销 + 协作者', () => {
		const r = formatRemoteDeleteConfirm([t('origin/foo', 'origin', 'foo')]);
		expect(r.confirmLabel).toBe('删除');
		expect(r.detail).toContain('origin/foo');
		expect(r.detail).toContain('不可撤销');
		expect(r.detail).toContain('协作者');
	});

	it('多条 → 含数量与截断名', () => {
		const r = formatRemoteDeleteConfirm([
			t('origin/b0', 'origin', 'b0'),
			t('origin/b1', 'origin', 'b1'),
			t('origin/b2', 'origin', 'b2'),
		]);
		expect(r.confirmLabel).toBe('删除');
		expect(r.detail).toContain('3 个');
	});

	it('多条超上限 → truncateNames 截断（…还有）', () => {
		const ts = Array.from({ length: 12 }, (_, i) => t(`origin/b${i}`, 'origin', `b${i}`));
		expect(formatRemoteDeleteConfirm(ts).detail).toContain('…还有');
	});

	it('含当前 HEAD 上游 → ⚠ 软警示', () => {
		const r = formatRemoteDeleteConfirm([t('origin/foo', 'origin', 'foo')], { hasUpstreamOfHead: true });
		expect(r.detail).toContain('上游');
		expect(r.detail).toContain('⚠');
	});

	it('非 origin remote 也回显 remote 名', () => {
		const r = formatRemoteDeleteConfirm([t('upstream/bar', 'upstream', 'bar')]);
		expect(r.detail).toContain('upstream');
	});
});
