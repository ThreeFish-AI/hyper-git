/**
 * 提交图 DAG lane 布局算法（纯逻辑，零 vscode 依赖）。
 *
 * 单遍、自顶向底（newest-first）增量算法：维护一张活跃 lane 表 `lanes: (parentHash|null)[]`
 * —— 槽值 = 该列「待下行抵达的父 hash」（一条尚未闭合的下行边），或 `null`（可复用的空洞）。
 * 「移除」= 置 `null`（不清色，保留分叉复用语义）；「插入」= 复用首个 `null` 槽或追加，
 * 这两种操作都不引起其他 lane 的左右位移，故分支「直顺」（参考 gitamine [1]）。
 *
 * 每个 commit 处理为：定位等待它的 lane（闭合其下行边）→ 着色 → 为其父开放下行边
 * （首父直行复用同槽；次父 fan-out 开新槽或收敛入既有槽）→ 导出本行的入边 / 出边 / 贯穿边。
 *
 * [1] P. Vigier, "Commit graph drawing algorithms," pvigier's blog, 2019.
 */

import type { GraphCommit, GraphEdge, GraphLayoutRow } from './graph-types';
import { pickDistinctColor, resolveNodeColor } from './graph-color';

/** 返回数组中首个 `null` 槽的索引；无则 -1。 */
function firstNull(arr: ReadonlyArray<string | null>): number {
	for (let i = 0; i < arr.length; i++) {
		if (arr[i] === null) {
			return i;
		}
	}
	return -1;
}

/**
 * 计算提交图布局。`commits` 须按 `--topo-order`（newest-first）排序。
 * 复杂度 O(n·L)，L = 瞬时并发 lane 数（现实 <10），1000 commit < 5ms。
 */
export function computeGraphLayout(commits: readonly GraphCommit[]): readonly GraphLayoutRow[] {
	// 加载窗口内的 hash 集合：O(n) 预扫，O(1) 查询「parent 是否在窗口」（截断边界判定）。
	const windowSet = new Set<string>();
	for (const c of commits) {
		windowSet.add(c.hash);
	}

	const lanes: (string | null)[] = []; // 活跃 lane 表：槽值 = 待达父 hash 或 null 空洞
	const laneColor: (number | null)[] = []; // 每槽调色板索引（nil 槽保留旧色，分叉复用）
	const rows: GraphLayoutRow[] = [];

	for (const c of commits) {
		// 本行处理前的 lane 快照（入边 / 贯穿边的来源）。
		const prevLanes = lanes.slice();
		const prevColor = laneColor.slice();

		// 步骤 A：定位等待 c.hash 的 lane（闭合其下行边）。
		const hit = prevLanes.indexOf(c.hash);
		let col: number;
		if (hit >= 0) {
			col = hit; // 复用既有 lane
		} else {
			// 新分支尖：复用首个 nil 槽或追加（不引起位移）。
			const ni = firstNull(lanes);
			col = ni >= 0 ? ni : lanes.length;
			if (col === lanes.length) {
				lanes.push(null);
				laneColor.push(null);
			}
		}

		const nodeColor = resolveNodeColor(laneColor, col, hit);
		const isMerge = c.parents.length > 1;

		// 步骤 B：入边 —— 所有 prevLanes 中等待 c.hash 的槽，其下行边抵达 node（收敛）。
		const incoming: GraphEdge[] = [];
		for (let k = 0; k < prevLanes.length; k++) {
			if (prevLanes[k] === c.hash) {
				incoming.push({
					fromCol: k,
					toCol: col,
					colorIdx: prevColor[k] ?? nodeColor,
					kind: k === col ? 'straight' : 'merge-in',
				});
			}
		}

		// 步骤 C：闭合 —— node 已抵达，释放所有等待 c.hash 的槽（置 nil，保留旧色）。
		for (let k = 0; k < lanes.length; k++) {
			if (lanes[k] === c.hash) {
				lanes[k] = null;
			}
		}

		// 步骤 D：出边 —— 为 c 的父开放下行边。
		const outgoing: GraphEdge[] = [];
		let hasDanglingParent = false;
		if (c.parents.length > 0) {
			const p0 = c.parents[0];
			if (windowSet.has(p0)) {
				lanes[col] = p0; // 首父直行：复用同槽，色沿首父链继承。
				laneColor[col] = nodeColor;
				outgoing.push({ fromCol: col, toCol: col, colorIdx: nodeColor, kind: 'straight' });
			} else {
				hasDanglingParent = true; // 截断边界：首父不在窗口，边悬空终止。
				outgoing.push({ fromCol: col, toCol: col, colorIdx: nodeColor, kind: 'dangling' });
			}
			// 次父 / octopus 父：fan-out 开新槽，或收敛入既有槽。
			for (let i = 1; i < c.parents.length; i++) {
				const pi = c.parents[i];
				if (!windowSet.has(pi)) {
					hasDanglingParent = true;
					outgoing.push({ fromCol: col, toCol: col, colorIdx: nodeColor, kind: 'dangling' });
					continue;
				}
				const existing = lanes.indexOf(pi);
				if (existing >= 0 && existing !== col) {
					// 收敛（CONVERGENCE）：pi 已被另一 lane 等待 → 连接，不开新槽。
					outgoing.push({ fromCol: col, toCol: existing, colorIdx: laneColor[existing] ?? nodeColor, kind: 'merge-in' });
				} else {
					const ni = firstNull(lanes);
					const slot = ni >= 0 ? ni : lanes.length;
					if (slot === lanes.length) {
						lanes.push(null);
						laneColor.push(null);
					}
					lanes[slot] = pi;
					laneColor[slot] = pickDistinctColor(laneColor, slot);
					outgoing.push({ fromCol: col, toCol: slot, colorIdx: laneColor[slot], kind: 'merge-in' });
				}
			}
		}

		// 步骤 E：贯穿边 —— prevLanes 中未被 node 消费的活跃 lane，全高竖线穿过本行。
		const passThrough: GraphEdge[] = [];
		for (let k = 0; k < prevLanes.length; k++) {
			if (prevLanes[k] !== null && prevLanes[k] !== c.hash) {
				passThrough.push({ fromCol: k, toCol: k, colorIdx: prevColor[k] ?? 0, kind: 'straight' });
			}
		}

		rows.push({
			hash: c.hash,
			node: { col, colorIdx: nodeColor },
			incoming,
			outgoing,
			passThrough,
			isMerge,
			hasDanglingParent,
		});
	}

	return rows;
}

/** 布局用到的最大瞬时并发 lane 数（= 最大列号 + 1），供渲染器预算图列总宽。 */
export function maxLanes(layout: readonly GraphLayoutRow[]): number {
	let m = 0;
	for (const row of layout) {
		m = Math.max(m, row.node.col);
		for (const e of row.incoming) {
			m = Math.max(m, e.fromCol, e.toCol);
		}
		for (const e of row.outgoing) {
			m = Math.max(m, e.fromCol, e.toCol);
		}
		for (const e of row.passThrough) {
			m = Math.max(m, e.fromCol, e.toCol);
		}
	}
	return m + 1;
}
