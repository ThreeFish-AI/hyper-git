import { describe, it, expect } from 'vitest';
import { CommitPipeline, CheckinResult } from '../../src/engine/commit/pipeline';
import type { CheckinHook, CommitInfo } from '../../src/engine/commit/pipeline';

const INFO: CommitInfo = { message: 'feat: x', filePaths: ['a.ts'] };

function spyHook(name: string, result: CheckinResult, order?: number): CheckinHook & { wasCalled: () => boolean } {
	let called = false;
	return {
		name,
		executionOrder: order,
		async beforeCheckin() {
			called = true;
			return result;
		},
		wasCalled: () => called,
	};
}

describe('CommitPipeline', () => {
	it('空 hook 链 → 放行提交', async () => {
		const pipeline = new CommitPipeline([]);
		expect(await pipeline.run(INFO)).toBe(CheckinResult.Commit);
	});

	it('全部放行 → Commit', async () => {
		const h1 = spyHook('a', CheckinResult.Commit);
		const h2 = spyHook('b', CheckinResult.Commit);
		const pipeline = new CommitPipeline([h1, h2]);
		expect(await pipeline.run(INFO)).toBe(CheckinResult.Commit);
		expect(h1.wasCalled()).toBe(true);
		expect(h2.wasCalled()).toBe(true);
	});

	it('任一 Cancel → 阻断', async () => {
		const h1 = spyHook('a', CheckinResult.Commit);
		const h2 = spyHook('b', CheckinResult.Cancel);
		const pipeline = new CommitPipeline([h1, h2]);
		expect(await pipeline.run(INFO)).toBe(CheckinResult.Cancel);
	});

	it('尊重 executionOrder（早的先跑；早返回 Cancel 则晚的不跑）', async () => {
		const late = spyHook('late', CheckinResult.Commit, 10);
		const early = spyHook('early', CheckinResult.Cancel, 1);
		const pipeline = new CommitPipeline([late, early]);
		expect(await pipeline.run(INFO)).toBe(CheckinResult.Cancel);
		expect(early.wasCalled()).toBe(true);
		expect(late.wasCalled()).toBe(false);
	});
});
