import { describe, it, expect } from 'vitest';
import { buildPrIndex, matchRemoteBranchPr } from '../../src/engine/pr/match';
import type { PullRequestVM } from '../../src/engine/pr/types';

function pr(overrides: Partial<PullRequestVM> = {}): PullRequestVM {
	return {
		number: 1,
		state: 'OPEN',
		isDraft: false,
		title: '',
		url: '',
		updatedAt: '2026-01-01T00:00:00Z',
		headRefName: 'feature',
		headOwner: 'acme',
		...overrides,
	};
}

const ACME = { repoOwner: 'acme', remotes: ['origin'] };

describe('buildPrIndex / matchRemoteBranchPr', () => {
	it('Tier a：remote 以 fork owner 命名，shortName 恰为 owner/branch 全名', () => {
		const prs = [pr({ headOwner: 'mylogin', headRefName: 'feature', number: 7 })];
		const hit = matchRemoteBranchPr('mylogin/feature', { repoOwner: 'acme', remotes: ['origin', 'mylogin'] }, prs);
		expect(hit?.number).toBe(7);
	});

	it('Tier b：剥 origin 前缀后同仓 headRefName 精确命中（dependabot 主场景）', () => {
		const prs = [pr({ headOwner: 'acme', headRefName: 'dependabot/npm_and_yarn/x', number: 138, state: 'MERGED' })];
		const hit = matchRemoteBranchPr('origin/dependabot/npm_and_yarn/x', ACME, prs);
		expect(hit?.number).toBe(138);
		expect(hit?.state).toBe('MERGED');
	});

	it('Tier a 优先于 Tier b（fork 全名与同仓分支双候选时 fork 全名先命中）', () => {
		const fork = pr({ headOwner: 'mylogin', headRefName: 'feature', number: 7 });
		// 同仓 PR 也用 headRefName 'feature'：若无 Tier a，剥 mylogin 前缀后 Tier b 会命中 #8 —— 优先级真正被钉住。
		const sameRepo = pr({ headOwner: 'acme', headRefName: 'feature', number: 8 });
		const hit = matchRemoteBranchPr('mylogin/feature', { repoOwner: 'acme', remotes: ['origin', 'mylogin'] }, [fork, sameRepo]);
		expect(hit?.number).toBe(7);
	});

	it('Tier a 判别：Tier c 歧义（两 fork 同名）时 remote 以 fork owner 命名仍精确命中', () => {
		const prs = [
			pr({ headOwner: 'fork1', headRefName: 'patch-1', number: 10 }),
			pr({ headOwner: 'fork2', headRefName: 'patch-1', number: 11 }),
		];
		// 若无 Tier a：剥 fork1 前缀后 Tier b 无候选、Tier c 二歧义 → undefined；Tier a 须命中 #10。
		const hit = matchRemoteBranchPr('fork1/patch-1', { repoOwner: 'acme', remotes: ['origin', 'fork1'] }, prs);
		expect(hit?.number).toBe(10);
	});

	it('owner 大小写不敏感：URL 形 repoOwner 与规范形 headOwner 仍走 Tier b', () => {
		const prs = [pr({ headOwner: 'Acme-Inc', headRefName: 'feature', number: 14 })];
		const hit = matchRemoteBranchPr('origin/feature', { repoOwner: 'acme-inc', remotes: ['origin'] }, prs);
		expect(hit?.number).toBe(14);
	});

	it('Tier a 键 owner 段大小写不敏感（remote 名与规范 login 大小写互异）', () => {
		const prs = [pr({ headOwner: 'MyLogin', headRefName: 'feature', number: 7 })];
		// remote 名小写 / login 规范形混合大小写，双向均须命中。
		expect(matchRemoteBranchPr('mylogin/feature', { repoOwner: 'acme', remotes: ['mylogin'] }, prs)?.number).toBe(7);
		expect(matchRemoteBranchPr('MyLogin/feature', { repoOwner: 'acme', remotes: ['MyLogin'] }, prs)?.number).toBe(7);
	});

	it('Tier c：非同仓 fork PR 且候选唯一 → 兜底命中', () => {
		const prs = [pr({ headOwner: 'contributor', headRefName: 'patch-1', number: 9 })];
		const hit = matchRemoteBranchPr('myfork/patch-1', { repoOwner: 'acme', remotes: ['myfork'] }, prs);
		expect(hit?.number).toBe(9);
	});

	it('Tier c 歧义（两个 fork 同名分支）→ 不匹配（宁缺勿错）', () => {
		const prs = [
			pr({ headOwner: 'fork1', headRefName: 'patch-1', number: 10 }),
			pr({ headOwner: 'fork2', headRefName: 'patch-1', number: 11 }),
		];
		expect(matchRemoteBranchPr('origin/patch-1', ACME, prs)).toBeUndefined();
		// 对照：同仓 PR 存在时 Tier b 直接命中（歧义仅发生在无同仓候选的兜底层）。
		const withSameRepo = [...prs, pr({ headOwner: 'acme', headRefName: 'patch-1', number: 12 })];
		expect(matchRemoteBranchPr('origin/patch-1', ACME, withSameRepo)?.number).toBe(12);
	});

	it('同 headRefName 多条同仓 PR → updatedAt 最近者胜', () => {
		const prs = [
			pr({ number: 10, state: 'MERGED', updatedAt: '2026-01-01T00:00:00Z' }),
			pr({ number: 20, state: 'OPEN', updatedAt: '2026-06-01T00:00:00Z' }),
		];
		const hit = matchRemoteBranchPr('origin/feature', ACME, prs);
		expect(hit?.number).toBe(20);
	});

	it('剥前缀失败（未知 remote / 纯 remote 名 / 本地形态）→ 不匹配', () => {
		const prs = [pr({ headRefName: 'x' })];
		expect(matchRemoteBranchPr('upstream/x', ACME, prs)).toBeUndefined();
		expect(matchRemoteBranchPr('origin', ACME, prs)).toBeUndefined();
		expect(matchRemoteBranchPr('x', ACME, prs)).toBeUndefined();
	});

	it('含 / 的 remote 名（myorg/repo）正确剥离后命中 Tier b', () => {
		const prs = [pr({ headRefName: 'feature', number: 12 })];
		const hit = matchRemoteBranchPr('myorg/repo/feature', { repoOwner: 'acme', remotes: ['myorg/repo'] }, prs);
		expect(hit?.number).toBe(12);
	});

	it('空 PR 列表 → 恒不匹配', () => {
		expect(matchRemoteBranchPr('origin/feature', ACME, [])).toBeUndefined();
	});

	it('headOwner 为空的 PR 不参与 Tier a', () => {
		const prs = [pr({ headOwner: '', headRefName: 'feature', number: 13 })];
		// shortName 恰为 `feature`（本地形态，本就剥离失败）→ 双保险不命中。
		expect(matchRemoteBranchPr('feature', ACME, prs)).toBeUndefined();
		// 剥离后走 Tier b/c：headOwner ≠ repoOwner → Tier c 唯一兜底命中（合法）。
		expect(matchRemoteBranchPr('origin/feature', ACME, prs)?.number).toBe(13);
	});

	it('buildPrIndex 与单发形态等价（索引可复用）', () => {
		const prs = [pr({ headRefName: 'a', number: 1 }), pr({ headRefName: 'b', number: 2 })];
		const idx = buildPrIndex(prs, ACME);
		expect(idx.lookup('origin/a')?.number).toBe(1);
		expect(idx.lookup('origin/b')?.number).toBe(2);
		expect(idx.lookup('origin/c')).toBeUndefined();
	});
});
