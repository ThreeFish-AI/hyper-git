/**
 * 提交图 lane 着色（纯逻辑，零 vscode 依赖）。
 *
 * 设计目标：实现「同一分支首父链同色、分叉点向次分支复用、相邻 lane 色相区分」着色语义。
 * 引擎只产出稳定的调色板索引（`colorIdx`），渲染器（webview）按主题将其映射为实际颜色
 * （优先 `--vscode-charts-*` 主题令牌，缺失时回退到 {@link DEFAULT_LANE_PALETTE}），
 * 从而实现深浅 / 高对比自适应。调色板 hex 作为单一事实源由 engine 导出，供 renderer 复用。
 */

/**
 * 默认 lane 调色板（GitHub-dark 风高饱和色，深浅主题均清晰可辨，相邻 lane 可区分）。
 * 渲染器按 `colorIdx % DEFAULT_LANE_PALETTE.length` 取色。
 */
export const DEFAULT_LANE_PALETTE: readonly string[] = [
	'#f85149', '#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#ff7b72', '#56d4dd', '#ffa657',
];

/** 调色板大小。 */
export const LANE_PALETTE_SIZE = DEFAULT_LANE_PALETTE.length;

/**
 * 为新开 / 复用的 lane 槽选取一个与左右邻槽色相区分的调色板索引。
 * 无法完全区分时回退到按槽位轮转（最坏情况偶有同色，但不崩溃）。
 */
export function pickDistinctColor(slotColors: ReadonlyArray<number | null>, slot: number): number {
	const neighbor = new Set<number>();
	for (const n of [slotColors[slot - 1], slotColors[slot + 1]]) {
		if (typeof n === 'number') {
			neighbor.add(n);
		}
	}
	for (let i = 0; i < LANE_PALETTE_SIZE; i++) {
		if (!neighbor.has(i)) {
			return i;
		}
	}
	return slot % LANE_PALETTE_SIZE;
}

/**
 * 解析本 commit 节点的调色板索引：
 * - `hit >= 0`（闭合既有下行边）：沿用该槽色（首父链继承）；
 * - 否则若槽位有旧色（复用 nil 空洞）：继承旧色（分叉点颜色复用语义）；
 * - 否则（全新追加槽）：{@link pickDistinctColor} 另起新色。
 */
export function resolveNodeColor(slotColors: ReadonlyArray<number | null>, col: number, hit: number): number {
	if (hit >= 0 && typeof slotColors[hit] === 'number') {
		return slotColors[hit] as number;
	}
	if (typeof slotColors[col] === 'number') {
		return slotColors[col] as number;
	}
	return pickDistinctColor(slotColors, col);
}
