import { describe, it, expect } from 'vitest';
import { buildPrQuery } from '../../src/engine/pr/graphql-query';

describe('buildPrQuery', () => {
	it('owner/name/after 走 $variables，不插值进文档', () => {
		const { query } = buildPrQuery({ first: 50 });
		expect(query).toContain('$owner: String!');
		expect(query).toContain('$name: String!');
		expect(query).toContain('$after: String');
		expect(query).toContain('after: $after');
	});

	it('first 插值且随入参变化', () => {
		expect(buildPrQuery({ first: 50 }).query).toContain('pullRequests(first: 50');
		expect(buildPrQuery({ first: 25 }).query).toContain('pullRequests(first: 25');
	});

	it('查询结构：全态 + UPDATED_AT 倒序 + pageInfo + 节点字段 + rateLimit', () => {
		const { query } = buildPrQuery({ first: 50 });
		expect(query).toContain('states: [OPEN, MERGED, CLOSED]');
		expect(query).toContain('orderBy: {field: UPDATED_AT, direction: DESC}');
		expect(query).toContain('pageInfo { hasNextPage endCursor }');
		expect(query).toContain('number state isDraft title url updatedAt headRefName headRepositoryOwner { login }');
		expect(query).toContain('rateLimit { cost remaining resetAt }');
	});

	it('first 边界抛错（非整数 / ≤0 / >100）', () => {
		expect(() => buildPrQuery({ first: 0 })).toThrow();
		expect(() => buildPrQuery({ first: -1 })).toThrow();
		expect(() => buildPrQuery({ first: 100.5 })).toThrow();
		expect(() => buildPrQuery({ first: 101 })).toThrow();
		expect(() => buildPrQuery({ first: Number.NaN })).toThrow();
	});

	it('首页形态合法：after 省略 / null 均可；空串抛错', () => {
		expect(() => buildPrQuery({ first: 50 })).not.toThrow();
		expect(() => buildPrQuery({ first: 50, after: null })).not.toThrow();
		expect(() => buildPrQuery({ first: 50, after: 'Y3Vyc29y' })).not.toThrow();
		expect(() => buildPrQuery({ first: 50, after: '' })).toThrow();
	});
});
