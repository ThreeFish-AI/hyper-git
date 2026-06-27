import { describe, it, expect } from 'vitest';
import { groupByChangelist } from '../../src/engine/changelist/grouper';
import type { ChangelistDef } from '../../src/engine/changelist/grouper';

const DEFS: ChangelistDef[] = [
	{ id: 'default', name: 'Default' },
	{ id: 'fx', name: 'Feature X' },
];

describe('groupByChangelist', () => {
	it('未分配项落入 active changelist', () => {
		const items = [{ k: 'a.ts' }, { k: 'b.ts' }];
		const groups = groupByChangelist(items, (i) => i.k, DEFS, {}, 'default');
		const def = groups.find((g) => g.id === 'default')!;
		expect(def.items).toHaveLength(2);
		expect(def.active).toBe(true);
	});

	it('按 assignment 分配到指定 changelist', () => {
		const items = [{ k: 'a.ts' }, { k: 'b.ts' }];
		const groups = groupByChangelist(items, (i) => i.k, DEFS, { 'a.ts': 'fx' }, 'default');
		expect(groups.find((g) => g.id === 'fx')!.items.map((i) => i.k)).toEqual(['a.ts']);
		expect(groups.find((g) => g.id === 'default')!.items.map((i) => i.k)).toEqual(['b.ts']);
	});

	it('保留 defs 顺序并标记 active', () => {
		const groups = groupByChangelist([], (i: { k: string }) => i.k, DEFS, {}, 'fx');
		expect(groups.map((g) => g.id)).toEqual(['default', 'fx']);
		expect(groups[0].active).toBe(false);
		expect(groups[1].active).toBe(true);
	});

	it('assignment 指向不存在的 changelist 时回退到 active', () => {
		const items = [{ k: 'a.ts' }];
		const groups = groupByChangelist(items, (i) => i.k, DEFS, { 'a.ts': 'ghost' }, 'default');
		expect(groups.find((g) => g.id === 'default')!.items).toHaveLength(1);
	});

	it('active 不在 defs 中时补一项兜底', () => {
		const items = [{ k: 'a.ts' }];
		const groups = groupByChangelist(items, (i) => i.k, DEFS, {}, 'orphan');
		const orphan = groups.find((g) => g.id === 'orphan');
		expect(orphan).toBeTruthy();
		expect(orphan!.active).toBe(true);
		expect(orphan!.items).toHaveLength(1);
	});
});
