import { describe, it, expect } from 'vitest';
import { planBranchUpdates, formatBranchUpdateResult, classifyFetchOutcome } from '../../src/engine/ref/branch-update';
import type { RawRef } from '../../src/engine/ref/for-each-ref';

/** 构造测试用本地分支 RawRef（for-each-ref 新鲜快照口径，upstream/head 可用）。 */
function ref(shortName: string, opts: Partial<RawRef> = {}): RawRef {
	return {
		refname: `refs/heads/${shortName}`,
		shortName,
		objectname: 'abc1234',
		head: false,
		isRemote: false,
		isTag: false,
		...opts,
	};
}

describe('planBranchUpdates', () => {
	it('head 命中 → pull-current（fetch refspec 对当前分支必被 git 拒绝），即使配置了上游', () => {
		const snapshot = new Map([['dev', ref('dev', { upstream: 'origin/dev' })]]);
		const plan = planBranchUpdates(['dev'], snapshot, 'dev', ['origin']);
		expect(plan).toEqual([{ kind: 'pull-current', name: 'dev' }]);
	});

	it('有上游 → fetch 动作携带 remote/upstreamBranch/beforeSha', () => {
		const snapshot = new Map([['feature/foo', ref('feature/foo', { upstream: 'origin/feature/foo', objectname: 'deadbee' })]]);
		const plan = planBranchUpdates(['feature/foo'], snapshot, 'main', ['origin']);
		expect(plan).toEqual([
			{ kind: 'fetch', name: 'feature/foo', remote: 'origin', upstreamBranch: 'feature/foo', beforeSha: 'deadbee' },
		]);
	});

	it('remote 名含 / ：最长前缀拆分（myorg/repo/feat → remote=myorg/repo, upstreamBranch=feat）', () => {
		const snapshot = new Map([['feat', ref('feat', { upstream: 'myorg/repo/feat' })]]);
		const plan = planBranchUpdates(['feat'], snapshot, undefined, ['origin', 'myorg/repo']);
		expect(plan).toEqual([{ kind: 'fetch', name: 'feat', remote: 'myorg/repo', upstreamBranch: 'feat', beforeSha: 'abc1234' }]);
	});

	it('无上游 → skip-no-upstream', () => {
		const snapshot = new Map([['orphan', ref('orphan')]]);
		const plan = planBranchUpdates(['orphan'], snapshot, 'main', ['origin']);
		expect(plan).toEqual([{ kind: 'skip-no-upstream', name: 'orphan' }]);
	});

	it('上游指向已不存在的 remote（陈旧配置）→ skip-no-upstream', () => {
		const snapshot = new Map([['stale', ref('stale', { upstream: 'gone/stale' })]]);
		const plan = planBranchUpdates(['stale'], snapshot, 'main', ['origin']);
		expect(plan).toEqual([{ kind: 'skip-no-upstream', name: 'stale' }]);
	});

	it('快照缺失（分支刚被并发删除）→ skip-no-upstream；重复名去重', () => {
		const snapshot = new Map([['a', ref('a', { upstream: 'origin/a' })]]);
		const plan = planBranchUpdates(['a', 'a', 'ghost'], snapshot, 'main', ['origin']);
		expect(plan).toEqual([
			{ kind: 'fetch', name: 'a', remote: 'origin', upstreamBranch: 'a', beforeSha: 'abc1234' },
			{ kind: 'skip-no-upstream', name: 'ghost' },
		]);
	});
});

describe('formatBranchUpdateResult', () => {
	it('单 updated → 点名分支，级别 info', () => {
		const result = formatBranchUpdateResult({ updated: ['main'], upToDate: [], pulled: [], skipped: [], failures: [] });
		expect(result).toEqual({ level: 'info', message: 'Updated branch main' });
	});

	it('多 updated → 计数；零计数段省略（无 pulled/skipped 不出现）', () => {
		const result = formatBranchUpdateResult({
			updated: ['a', 'b'],
			upToDate: ['c', 'd'],
			pulled: [],
			skipped: [],
			failures: [],
		});
		expect(result).toEqual({ level: 'info', message: 'Updated 2 branches; 2 already up to date' });
	});

	it('单 upToDate → 点名；pulled/skipped 段并存', () => {
		const result = formatBranchUpdateResult({
			updated: [],
			upToDate: ['c'],
			pulled: ['dev'],
			skipped: ['orphan'],
			failures: [],
		});
		expect(result).toEqual({
			level: 'info',
			message: 'c is already up to date; Pulled current branch dev; 1 skipped (no upstream): orphan',
		});
	});

	it('有失败 → 级别 error，条目 name (reason) 且多行 reason 折叠单行', () => {
		const result = formatBranchUpdateResult({
			updated: ['a'],
			upToDate: [],
			pulled: [],
			skipped: [],
			failures: [{ name: 'b', reason: '! [rejected] b -> b (non-fast-forward)\nhint: …' }],
		});
		expect(result.level).toBe('error');
		expect(result.message).toBe(
			'Updated branch a; 1 failed: b (! [rejected] b -> b (non-fast-forward); hint: …)',
		);
	});

	it('仅失败（无任何成功段）→ 文案不以空段开头', () => {
		const result = formatBranchUpdateResult({
			updated: [],
			upToDate: [],
			pulled: [],
			skipped: [],
			failures: [{ name: 'x', reason: 'fatal: refusing to fetch into branch … checked out at …' }],
		});
		expect(result).toEqual({
			level: 'error',
			message: '1 failed: x (fatal: refusing to fetch into branch … checked out at …)',
		});
	});
});

describe('classifyFetchOutcome', () => {
	it('同 commit 且缩写变长（对象数跨阈值，7→8 位）→ upToDate（前缀语义，非严格全等）', () => {
		expect(classifyFetchOutcome('abc1234', 'abc12345')).toBe('upToDate');
	});

	it('真更新（不同 commit）→ updated', () => {
		expect(classifyFetchOutcome('abc1234', 'deadbee')).toBe('updated');
	});

	it('afterSha 缺失（分支被并发删除）→ 保守 updated', () => {
		expect(classifyFetchOutcome('abc1234', undefined)).toBe('updated');
	});
});
