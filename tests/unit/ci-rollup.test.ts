import { describe, it, expect } from 'vitest';
import {
	aggregateChecks,
	checkRunState,
	mapRollupState,
	pickPrimaryUrl,
	recomputeState,
	statusContextState,
} from '../../src/engine/ci/rollup';
import type { CiCheckVM } from '../../src/engine/ci/types';

describe('mapRollupState（rollup StatusState → CiState）', () => {
	it('SUCCESS → success', () => {
		expect(mapRollupState('SUCCESS')).toBe('success');
	});
	it('FAILURE/ERROR → failure', () => {
		expect(mapRollupState('FAILURE')).toBe('failure');
		expect(mapRollupState('ERROR')).toBe('failure');
	});
	it('PENDING/EXPECTED → pending', () => {
		expect(mapRollupState('PENDING')).toBe('pending');
		expect(mapRollupState('EXPECTED')).toBe('pending');
	});
	it('空/未知 → unknown', () => {
		expect(mapRollupState(null)).toBe('unknown');
		expect(mapRollupState(undefined)).toBe('unknown');
		expect(mapRollupState('')).toBe('unknown');
	});
});

describe('checkRunState（CheckRun status+conclusion → CiState）', () => {
	it('未完成一律 pending', () => {
		expect(checkRunState('IN_PROGRESS', null)).toBe('pending');
		expect(checkRunState('QUEUED', null)).toBe('pending');
		expect(checkRunState('WAITING', null)).toBe('pending');
	});
	it('COMPLETED + SUCCESS → success', () => {
		expect(checkRunState('COMPLETED', 'SUCCESS')).toBe('success');
	});
	it('COMPLETED + 非阻塞结论 → success', () => {
		expect(checkRunState('COMPLETED', 'NEUTRAL')).toBe('success');
		expect(checkRunState('COMPLETED', 'SKIPPED')).toBe('success');
	});
	it('COMPLETED + 失败结论 → failure', () => {
		for (const c of ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE']) {
			expect(checkRunState('COMPLETED', c)).toBe('failure');
		}
	});
	it('COMPLETED + 未知结论 → pending（保守）', () => {
		expect(checkRunState('COMPLETED', null)).toBe('pending');
	});
});

describe('statusContextState（复用 rollup 映射）', () => {
	it('与 mapRollupState 一致', () => {
		expect(statusContextState('SUCCESS')).toBe('success');
		expect(statusContextState('FAILURE')).toBe('failure');
		expect(statusContextState('PENDING')).toBe('pending');
	});
});

describe('pickPrimaryUrl', () => {
	const ck = (over: Partial<CiCheckVM>): CiCheckVM => ({ name: 'n', state: 'success', ...over });
	it('优先首个失败项的 url', () => {
		const checks = [ck({ state: 'success', url: 'a' }), ck({ state: 'failure', url: 'b' }), ck({ state: 'failure', url: 'c' })];
		expect(pickPrimaryUrl(checks)).toBe('b');
	});
	it('无失败项时取首个有 url 项', () => {
		const checks = [ck({ url: 'a' }), ck({ url: 'b' })];
		expect(pickPrimaryUrl(checks)).toBe('a');
	});
	it('全无 url → undefined', () => {
		expect(pickPrimaryUrl([ck({})])).toBeUndefined();
	});
});

describe('recomputeState / aggregateChecks', () => {
	const ck = (state: CiCheckVM['state']): CiCheckVM => ({ name: 'n', state });
	it('recompute：任一 failure→failure；否则任一 pending→pending；否则 success；空→unknown', () => {
		expect(recomputeState([ck('success'), ck('failure')])).toBe('failure');
		expect(recomputeState([ck('success'), ck('pending')])).toBe('pending');
		expect(recomputeState([ck('success'), ck('success')])).toBe('success');
		expect(recomputeState([])).toBe('unknown');
	});
	it('aggregate：rollupState 权威优先', () => {
		const vm = aggregateChecks('failure', [ck('success'), ck('success')]);
		expect(vm.state).toBe('failure');
		expect(vm.passed).toBe(2);
		expect(vm.total).toBe(2);
	});
	it('aggregate：rollupState=unknown 时据 checks 兜底重算', () => {
		const vm = aggregateChecks('unknown', [ck('success'), ck('pending')]);
		expect(vm.state).toBe('pending');
	});
	it('aggregate：空 checks → unknown', () => {
		expect(aggregateChecks('unknown', []).state).toBe('unknown');
	});
});
