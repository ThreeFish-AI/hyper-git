import { describe, it, expect } from 'vitest';
import { buildCiQuery, CI_ALIAS_PREFIX, DEFAULT_CONTEXTS_PER_COMMIT } from '../../src/engine/ci/graphql-query';

const OIDS = ['a1b2c3d4e5f6', '0123456789abcdef0123456789abcdef01234567', 'fedcba9876543210'];

describe('buildCiQuery', () => {
	it('生成与 oid 等量的别名（c0..cN）', () => {
		const { aliases } = buildCiQuery({ owner: 'o', name: 'r', oids: OIDS });
		expect(aliases).toEqual(['c0', 'c1', 'c2']);
		expect(aliases[0]).toBe(CI_ALIAS_PREFIX + 0);
	});

	it('owner/name 走 $variables，不插值进文档', () => {
		const { query } = buildCiQuery({ owner: 'Own/er', name: 'r/evil', oids: OIDS });
		expect(query).toContain('$owner');
		expect(query).toContain('$name');
		// 危险字符不应出现在文档里（防注入）。
		expect(query).not.toContain('Own/er');
		expect(query).not.toContain('r/evil');
	});

	it('oid 经校验后插值别名', () => {
		const { query } = buildCiQuery({ owner: 'o', name: 'r', oids: ['abcdef0', '1234567'] });
		expect(query).toContain('c0: object(oid: "abcdef0")');
		expect(query).toContain('c1: object(oid: "1234567")');
	});

	it('复用 fragment（statusCheckRollup + 两种 inline fragment）', () => {
		const { query } = buildCiQuery({ owner: 'o', name: 'r', oids: ['abcdef0'] });
		expect(query).toContain('fragment CiCommitRollup on Commit');
		expect(query).toContain('statusCheckRollup');
		expect(query).toContain('... on CheckRun');
		expect(query).toContain('... on StatusContext');
		expect(query).toContain('rateLimit { cost remaining resetAt }');
	});

	it('默认 contexts(first) 取 DEFAULT_CONTEXTS_PER_COMMIT', () => {
		const { query } = buildCiQuery({ owner: 'o', name: 'r', oids: ['abcdef0'] });
		expect(query).toContain(`contexts(first: ${DEFAULT_CONTEXTS_PER_COMMIT})`);
	});

	it('非法 oid 抛错（防构造畸形查询）', () => {
		expect(() => buildCiQuery({ owner: 'o', name: 'r', oids: ['ZZZZZZ'] })).toThrow();
		expect(() => buildCiQuery({ owner: 'o', name: 'r', oids: ['"; DROP--'] })).toThrow();
	});

	it('空 oids 抛错', () => {
		expect(() => buildCiQuery({ owner: 'o', name: 'r', oids: [] })).toThrow();
	});

	it('非法 contextsPerCommit 抛错', () => {
		expect(() => buildCiQuery({ owner: 'o', name: 'r', oids: ['abcdef0'], contextsPerCommit: 0 })).toThrow();
		expect(() => buildCiQuery({ owner: 'o', name: 'r', oids: ['abcdef0'], contextsPerCommit: -5 })).toThrow();
	});
});
