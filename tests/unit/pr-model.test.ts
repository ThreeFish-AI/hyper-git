import { describe, it, expect } from 'vitest';
import { parsePullRequestsResponse, prBadge, prStateLabel, prsEqual } from '../../src/engine/pr/model';
import type { PullRequestVM } from '../../src/engine/pr/types';

function node(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		number: 138,
		state: 'MERGED',
		isDraft: false,
		title: 'Bump deps',
		url: 'https://github.com/o/r/pull/138',
		updatedAt: '2026-10-01T00:00:00Z',
		headRefName: 'dependabot/npm_and_yarn/x',
		headRepositoryOwner: { login: 'o' },
		headRepository: { name: 'r' },
		...overrides,
	};
}

function page(nodes: unknown[], pageInfo: Record<string, unknown> = { hasNextPage: false, endCursor: null }): unknown {
	return { data: { repository: { pullRequests: { nodes, pageInfo } } } };
}

const VM: PullRequestVM = {
	number: 138,
	state: 'MERGED',
	isDraft: false,
	title: 'Bump deps',
	url: 'https://github.com/o/r/pull/138',
	updatedAt: '2026-10-01T00:00:00Z',
	headRefName: 'dependabot/npm_and_yarn/x',
	headOwner: 'o',
	headRepo: 'r',
};

describe('parsePullRequestsResponse', () => {
	it('正常路径全字段映射（headOwner 取 login）', () => {
		const out = parsePullRequestsResponse(page([node()]));
		expect(out?.prs).toHaveLength(1);
		expect(out?.prs[0]).toEqual(VM);
	});

	it('headRepositoryOwner null → headOwner 空串；headRepository null → headRepo 空串', () => {
		const out = parsePullRequestsResponse(page([node({ headRepositoryOwner: null, headRepository: null })]));
		expect(out?.prs[0]?.headOwner).toBe('');
		expect(out?.prs[0]?.headRepo).toBe('');
	});

	it('非法 state / 非正数 number 的节点被丢弃，其余保留', () => {
		const out = parsePullRequestsResponse(page([node({ state: 'WEIRD' }), node({ number: 0 }), node({ number: 139 })]));
		expect(out?.prs).toHaveLength(1);
		expect(out?.prs[0]?.number).toBe(139);
	});

	it('字段级非字符串值归空串（title/url/updatedAt/headRefName 守卫，节点不丢弃）', () => {
		const out = parsePullRequestsResponse(page([node({ title: 42, url: null, updatedAt: true, headRefName: { x: 1 } })]));
		expect(out?.prs).toHaveLength(1);
		expect(out?.prs[0]).toMatchObject({ number: 138, title: '', url: '', updatedAt: '', headRefName: '' });
	});

	it('nodes 数组内 null 元素被丢弃', () => {
		expect(parsePullRequestsResponse(page([null]))?.prs).toEqual([]);
	});

	it('连接级 nodes: null / 非数组 / [] → 空页（合法，不抛错）', () => {
		const nullNodes = { data: { repository: { pullRequests: { nodes: null, pageInfo: { hasNextPage: false, endCursor: null } } } } };
		expect(parsePullRequestsResponse(nullNodes)?.prs).toEqual([]);
		const objectNodes = { data: { repository: { pullRequests: { nodes: { '0': node() }, pageInfo: null } } } };
		expect(parsePullRequestsResponse(objectNodes)?.prs).toEqual([]);
		const empty = parsePullRequestsResponse(page([]));
		expect(empty?.prs).toEqual([]);
		expect(empty?.hasNextPage).toBe(false);
		expect(empty?.endCursor).toBeNull();
	});

	it('缺 data / repository / pullRequests → null（不缓存）', () => {
		expect(parsePullRequestsResponse(undefined)).toBeNull();
		expect(parsePullRequestsResponse({})).toBeNull();
		expect(parsePullRequestsResponse({ data: {} })).toBeNull();
		expect(parsePullRequestsResponse({ data: { repository: {} } })).toBeNull();
		expect(parsePullRequestsResponse({ errors: [{ message: 'x' }] })).toBeNull();
	});

	it('pageInfo 透传：hasNextPage + endCursor；endCursor 非法 → null', () => {
		const out = parsePullRequestsResponse(page([node()], { hasNextPage: true, endCursor: 'abc' }));
		expect(out?.hasNextPage).toBe(true);
		expect(out?.endCursor).toBe('abc');
		const bad = parsePullRequestsResponse(page([node()], { hasNextPage: true, endCursor: 42 }));
		expect(bad?.endCursor).toBeNull();
	});
});

describe('prStateLabel / prBadge', () => {
	it('四态文案：Open / Draft / Merged / Closed', () => {
		expect(prStateLabel({ state: 'OPEN', isDraft: false })).toBe('Open');
		expect(prStateLabel({ state: 'OPEN', isDraft: true })).toBe('Draft');
		expect(prStateLabel({ state: 'MERGED', isDraft: false })).toBe('Merged');
		expect(prStateLabel({ state: 'CLOSED', isDraft: false })).toBe('Closed');
	});

	it('prBadge → `#138 Merged`', () => {
		expect(prBadge(VM)).toBe('#138 Merged');
	});
});

describe('prsEqual', () => {
	it('同引用 / 全等 / 任一字段差 / 长度差', () => {
		expect(prsEqual([VM], [VM])).toBe(true);
		expect(prsEqual([VM], [{ ...VM }])).toBe(true);
		expect(prsEqual([VM], [{ ...VM, state: 'OPEN' }])).toBe(false);
		expect(prsEqual([VM], [{ ...VM, isDraft: true }])).toBe(false);
		expect(prsEqual([VM], [{ ...VM, title: 'x' }])).toBe(false);
		expect(prsEqual([VM], [{ ...VM, url: 'x' }])).toBe(false);
		expect(prsEqual([VM], [{ ...VM, updatedAt: 'x' }])).toBe(false);
		expect(prsEqual([VM], [{ ...VM, headRefName: 'x' }])).toBe(false);
		expect(prsEqual([VM], [{ ...VM, headOwner: 'x' }])).toBe(false);
		expect(prsEqual([VM], [{ ...VM, headRepo: 'x' }])).toBe(false);
		expect(prsEqual([VM], [])).toBe(false);
	});
});
