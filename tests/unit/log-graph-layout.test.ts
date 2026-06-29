import { describe, it, expect } from 'vitest';
import { computeGraphLayout, maxLanes } from '../../src/engine/log/graph-layout';
import type { GraphCommit } from '../../src/engine/log/graph-types';

const C = (hash: string, parents: readonly string[] = []): GraphCommit => ({ hash, parents });

describe('computeGraphLayout — 线性历史', () => {
	it('单链：全部 col0，首父链同色，纯 straight 出边', () => {
		const rows = computeGraphLayout([C('a', ['b']), C('b', ['c']), C('c')]);
		expect(rows.map((r) => r.node.col)).toEqual([0, 0, 0]);
		expect(rows.every((r) => r.node.colorIdx === rows[0].node.colorIdx)).toBe(true);
		expect(rows[0].outgoing.every((e) => e.kind === 'straight')).toBe(true);
		expect(rows[2].hasDanglingParent).toBe(false); // c 是 root，非截断
		expect(maxLanes(rows)).toBe(1);
	});
});

describe('computeGraphLayout — 分支 + 合并（钻石）', () => {
	//   a (merge: b,c)
	//  /|
	// b |  b@col0  c@col1
	//  \|
	//   d (root)
	const rows = computeGraphLayout([C('a', ['b', 'c']), C('b', ['d']), C('c', ['d']), C('d')]);

	it('merge 节点 col0，次父 fan-out 到 col1', () => {
		expect(rows[0].node.col).toBe(0);
		expect(rows[0].isMerge).toBe(true);
		expect(rows[0].outgoing.some((e) => e.kind === 'merge-in' && e.fromCol === 0 && e.toCol === 1)).toBe(true);
	});

	it('两条分支分别落在 col0 / col1，且贯穿彼此 lane', () => {
		expect(rows[1].node.col).toBe(0); // b
		expect(rows[2].node.col).toBe(1); // c
		expect(rows[1].passThrough.some((e) => e.fromCol === 1)).toBe(true); // c 的 lane 穿过 b
	});

	it('汇合点 d：次父以 merge-in 收敛入 col0', () => {
		expect(rows[3].node.col).toBe(0);
		expect(rows[3].incoming.some((e) => e.kind === 'merge-in' && e.fromCol === 1 && e.toCol === 0)).toBe(true);
	});

	it('相邻 lane 着色区分', () => {
		expect(rows[1].node.colorIdx).not.toBe(rows[2].node.colorIdx);
	});

	it('maxLanes = 2', () => {
		expect(maxLanes(rows)).toBe(2);
	});
});

describe('computeGraphLayout — Octopus 合并（3 parents）', () => {
	it('首父 col0，两个次父各 fan-out', () => {
		const rows = computeGraphLayout([C('m', ['p1', 'p2', 'p3']), C('p1'), C('p2'), C('p3')]);
		expect(rows[0].node.col).toBe(0);
		const mergeIns = rows[0].outgoing.filter((e) => e.kind === 'merge-in');
		expect(mergeIns).toHaveLength(2);
		expect(new Set(mergeIns.map((e) => e.toCol))).toEqual(new Set([1, 2]));
	});
});

describe('computeGraphLayout — 多 root / 不连通历史', () => {
	it('两条独立链顺序复用 col0，互不干扰', () => {
		const rows = computeGraphLayout([C('a', ['b']), C('b'), C('x', ['y']), C('y')]);
		expect(rows[0].node.col).toBe(0); // a
		expect(rows[2].node.col).toBe(0); // x 复用释放后的 nil 槽
		expect(maxLanes(rows)).toBe(1);
	});
});

describe('computeGraphLayout — 截断边界（dangling parent）', () => {
	it('首父不在窗口：hasDanglingParent，emit dangling 出边', () => {
		const rows = computeGraphLayout([C('a', ['UNLOADED'])]);
		expect(rows[0].hasDanglingParent).toBe(true);
		expect(rows[0].outgoing.some((e) => e.kind === 'dangling')).toBe(true);
	});

	it('次父不在窗口：merge + dangling，不为悬空父开活跃槽', () => {
		const rows = computeGraphLayout([C('m', ['p', 'UNLOADED']), C('p')]);
		expect(rows[0].hasDanglingParent).toBe(true);
		expect(rows[0].isMerge).toBe(true);
		expect(maxLanes(rows)).toBe(1); // UNLOADED 不占槽
	});
});

describe('computeGraphLayout — 收敛（convergence）', () => {
	// a→s, b→s：a 落 col0、b 落 col1，各自首父 s 直行下行；两条 lane 在 s 节点处收敛
	// （col1 的下行边以 merge-in 收敛入 col0），不会为 s 再开第三条 lane。
	it('两个子指向同一父：父节点处收敛（incoming merge-in），不开第三条 lane', () => {
		const rows = computeGraphLayout([C('a', ['s']), C('b', ['s']), C('s')]);
		expect(rows[0].node.col).toBe(0); // a
		expect(rows[1].node.col).toBe(1); // b 开新 lane
		expect(rows[1].outgoing.some((e) => e.kind === 'straight' && e.toCol === 1)).toBe(true); // b 首父直行
		expect(rows[2].node.col).toBe(0); // s 落在 col0
		expect(rows[2].incoming.some((e) => e.kind === 'merge-in' && e.fromCol === 1 && e.toCol === 0)).toBe(true);
		expect(maxLanes(rows)).toBe(2); // 仅两条 lane
	});
});

describe('computeGraphLayout — 确定性与边界', () => {
	it('同一输入两次调用结果深相等', () => {
		const input = [C('a', ['b', 'c']), C('b'), C('c')];
		expect(computeGraphLayout(input)).toEqual(computeGraphLayout(input));
	});

	it('空输入返回空数组', () => {
		expect(computeGraphLayout([])).toEqual([]);
	});

	it('全 root：全部 col0 不崩溃', () => {
		const rows = computeGraphLayout([C('a'), C('b'), C('c')]);
		expect(rows.map((r) => r.node.col)).toEqual([0, 0, 0]);
		expect(maxLanes(rows)).toBe(1);
	});
});
