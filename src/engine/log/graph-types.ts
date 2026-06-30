/**
 * 提交图 DAG 布局的数据契约（纯逻辑，零 vscode 依赖）。
 *
 * 引擎消费最小 commit 投影（{@link GraphCommit}，仅需 hash + parents），输出渲染器无关的
 * 逐行布局（{@link GraphLayoutRow}）。渲染层（adapter webview）据此绘制彩色泳道，自绘可视化
 * Graph 效果——不再依赖 `git log --graph` 的粗糙 ASCII（lane 由 git 分配、
 * 不可控、随列号抖动着色）。算法参考 gitamine 的 nil-slot 复用 [1] 与 git-graph 的分支区间装箱 [2]。
 *
 * 调用方须保证 commits 按 `--topo-order`（newest-first 且子在父之上）排序——lane 增量算法依赖
 * 「处理 commit 时其全部在窗口内的子已处理」这一不变量，否则 lane 会断裂。
 *
 * [1] P. Vigier, "Commit graph drawing algorithms," pvigier's blog, 2019.
 * [2] M. Lange, "git-graph: branch assignment & lane layout," 2025.
 */

/** 引擎所需的最小 commit 投影（adapter 由 `git log` 解析结果映射）。 */
export interface GraphCommit {
	readonly hash: string;
	/** 有序父；`parents[0]` = 首父。root 提交为空数组；>1 个父为 merge（含 octopus）。 */
	readonly parents: readonly string[];
}

/** 边段种类，决定渲染器画直线 / 斜线 / 截断淡出。 */
export type GraphEdgeKind = 'straight' | 'merge-in' | 'dangling';

/**
 * 单条边段（列号语义，渲染器无关）：
 * - `incoming`：`fromCol`(上一行底) → `toCol`(= node.col，本行中心)，抵达 node 的下行边；
 * - `outgoing`：`fromCol`(= node.col) → `toCol`(本行底)，从 node 出发的下行边；
 * - `passThrough`：`fromCol === toCol`，贯穿本行全高的活跃 lane。
 */
export interface GraphEdge {
	readonly fromCol: number;
	readonly toCol: number;
	/** 调色板索引（稳定，渲染器按主题映射为实际颜色）。 */
	readonly colorIdx: number;
	readonly kind: GraphEdgeKind;
}

/** 单行布局结果，与输入 commits 数组按索引一一对应（newest-first 拓扑序）。 */
export interface GraphLayoutRow {
	readonly hash: string;
	/** 本 commit 节点的列号与调色板索引。 */
	readonly node: { readonly col: number; readonly colorIdx: number };
	/** 入边（上一行底 → 本行 node 中心）：抵达 node 的下行边，含收敛斜入。 */
	readonly incoming: readonly GraphEdge[];
	/** 出边（node 中心 → 本行底）：首父 `straight`、次父 `merge-in`、截断 `dangling`。 */
	readonly outgoing: readonly GraphEdge[];
	/** 贯穿全高的竖线：穿过本行但不涉及本 node 的活跃 lane。 */
	readonly passThrough: readonly GraphEdge[];
	readonly isMerge: boolean;
	/** 是否触及截断边界（有 parent 不在加载窗口内）。 */
	readonly hasDanglingParent: boolean;
}
