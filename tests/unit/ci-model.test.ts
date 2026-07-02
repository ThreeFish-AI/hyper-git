import { describe, it, expect } from 'vitest';
import { extractRateLimit, parseCiResponse, UNKNOWN_CI } from '../../src/engine/ci/model';

const repo = (entries: Record<string, unknown>): unknown => ({ data: { repository: entries } });
const oid = (i: number): string => i.toString(16).padStart(40, '0');

describe('parseCiResponse', () => {
	it('别名值为 null（未推送本地提交）→ unknown', () => {
		const map = parseCiResponse(repo({ c0: null }), [oid(0)]);
		expect(map.get(oid(0))).toEqual(UNKNOWN_CI);
		expect(map.get(oid(0))?.state).toBe('unknown');
	});

	it('rollup 缺失（无 CI 配置）→ unknown', () => {
		const map = parseCiResponse(repo({ c0: { statusCheckRollup: null } }), [oid(0)]);
		expect(map.get(oid(0))?.state).toBe('unknown');
	});

	it('rollup.state 权威映射（SUCCESS）', () => {
		const json = repo({
			c0: { statusCheckRollup: { state: 'SUCCESS', contexts: { totalCount: 1, nodes: [
				{ __typename: 'CheckRun', name: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/o/r/runs/1' },
			] } } },
		});
		const map = parseCiResponse(json, [oid(0)]);
		const vm = map.get(oid(0))!;
		expect(vm.state).toBe('success');
		expect(vm.passed).toBe(1);
		expect(vm.total).toBe(1);
		expect(vm.url).toBe('https://github.com/o/r/runs/1');
	});

	it('混合 CheckRun + StatusContext，rollup=FAILURE → failure，失败项 url 优先', () => {
		const json = repo({
			c0: { statusCheckRollup: { state: 'FAILURE', contexts: { totalCount: 3, nodes: [
				{ __typename: 'CheckRun', name: 'Build', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/o/r/runs/2' },
				{ __typename: 'CheckRun', name: 'Test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://github.com/o/r/runs/3' },
				{ __typename: 'StatusContext', context: 'external-ci', state: 'SUCCESS', targetUrl: 'https://ci.example.com/1', description: 'ok' },
			] } } },
		});
		const map = parseCiResponse(json, [oid(0)]);
		const vm = map.get(oid(0))!;
		expect(vm.state).toBe('failure');
		expect(vm.total).toBe(3);
		expect(vm.checks).toHaveLength(3);
		// 首个失败项（Test）的 url 优先。
		expect(vm.url).toBe('https://github.com/o/r/runs/3');
		// StatusContext 归一与 description 透传。
		const ext = vm.checks.find((c) => c.name === 'external-ci')!;
		expect(ext.state).toBe('success');
		expect(ext.description).toBe('ok');
	});

	it('rollup=FAILURE 但无任何 context 节点 → 仍 failure（rollup 权威），checks 空', () => {
		const json = repo({ c0: { statusCheckRollup: { state: 'FAILURE', contexts: { totalCount: 0, nodes: [] } } } });
		const map = parseCiResponse(json, [oid(0)]);
		const vm = map.get(oid(0))!;
		expect(vm.state).toBe('failure');
		expect(vm.checks).toHaveLength(0);
		expect(vm.total).toBe(0);
	});

	it('按别名序号映射多个 oid', () => {
		const json = repo({
			c0: { statusCheckRollup: { state: 'SUCCESS', contexts: { totalCount: 0, nodes: [] } } },
			c1: null,
			c2: { statusCheckRollup: { state: 'PENDING', contexts: { totalCount: 1, nodes: [
				{ __typename: 'CheckRun', name: 'X', status: 'IN_PROGRESS', conclusion: null },
			] } } },
		});
		const map = parseCiResponse(json, [oid(0), oid(1), oid(2)]);
		expect(map.get(oid(0))?.state).toBe('success');
		expect(map.get(oid(1))?.state).toBe('unknown');
		expect(map.get(oid(2))?.state).toBe('pending');
	});

	it('缺 data/repository → 整批回退 unknown（不抛错）', () => {
		const map = parseCiResponse({ errors: [{ message: 'boom' }] }, [oid(0), oid(1)]);
		expect(map.get(oid(0))?.state).toBe('unknown');
		expect(map.get(oid(1))?.state).toBe('unknown');
	});

	it('不可识别的 __typename 节点被过滤', () => {
		const json = repo({
			c0: { statusCheckRollup: { state: 'SUCCESS', contexts: { totalCount: 2, nodes: [
				{ __typename: 'CheckRun', name: 'A', status: 'COMPLETED', conclusion: 'SUCCESS' },
				{ __typename: 'SomethingElse', name: 'B' },
			] } } },
		});
		const vm = parseCiResponse(json, [oid(0)]).get(oid(0))!;
		expect(vm.checks).toHaveLength(1);
		expect(vm.checks[0].name).toBe('A');
	});
});

describe('extractRateLimit', () => {
	it('抽取 remaining / resetAt', () => {
		const rl = extractRateLimit({ data: { rateLimit: { cost: 1, remaining: 42, resetAt: '2026-01-01T00:00:00Z' } } });
		expect(rl?.remaining).toBe(42);
		expect(rl?.resetAt).toBe('2026-01-01T00:00:00Z');
	});
	it('缺失返回 null', () => {
		expect(extractRateLimit({ data: {} })).toBeNull();
		expect(extractRateLimit({})).toBeNull();
	});
});
