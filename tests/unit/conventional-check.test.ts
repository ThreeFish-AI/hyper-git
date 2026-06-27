import { describe, it, expect } from 'vitest';
import { CheckinResult } from '../../src/engine/commit/pipeline';
import { ConventionalCommitCheck } from '../../src/adapter/commit/conventional-check';

describe('ConventionalCommitCheck', () => {
	it('isEnabled=false → 恒放行（即使信息不合规）', async () => {
		const check = new ConventionalCommitCheck(() => false);
		expect(check.name).toBe('conventional-commit-check');
		const r = await check.beforeCheckin({ message: '不合规的信息', filePaths: [] });
		expect(r).toBe(CheckinResult.Commit);
	});

	it('isEnabled=true + 合规 → Commit', async () => {
		const check = new ConventionalCommitCheck(() => true);
		const r = await check.beforeCheckin({ message: 'feat(scope): 合规', filePaths: [] });
		expect(r).toBe(CheckinResult.Commit);
	});

	it('isEnabled=true + 不合规 → Cancel', async () => {
		const check = new ConventionalCommitCheck(() => true);
		const r = await check.beforeCheckin({ message: '不合规', filePaths: [] });
		expect(r).toBe(CheckinResult.Cancel);
	});

	it('isEnabled=true + 空信息 → Cancel', async () => {
		const check = new ConventionalCommitCheck(() => true);
		const r = await check.beforeCheckin({ message: '   ', filePaths: [] });
		expect(r).toBe(CheckinResult.Cancel);
	});

	it('executionOrder 较小（早执行，对齐 IDEA ExecutionOrder.EARLY）', () => {
		const check = new ConventionalCommitCheck(() => true);
		expect(check.executionOrder ?? 100).toBeLessThanOrEqual(50);
	});
});
