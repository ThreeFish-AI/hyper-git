/**
 * `git log --graph` 解析器（纯逻辑，零 vscode 依赖）。
 *
 * 解析 `git log --graph --format=%x00%H%x00%d%x00%s` 输出：每行 = graph ASCII 前缀 + NUL 分隔的
 * [hash, decorate, subject]。graph 续行（分叉/合并的 `|\` 等连线，无 commit）不含 NUL。
 * git 已完成 lane 分配（`* | / \ _` 的列布局），解析器只做行级拆分，渲染层按字符粒度还原拓扑。
 */

export interface GraphRow {
	/** graph ASCII（已去尾空白）；续行可能为空串。 */
	readonly graph: string;
	/** 完整 hash（仅 commit 行有）。 */
	readonly hash?: string;
	/** refs 装饰（%d，如 " (HEAD -> main, origin/main)"）；已 trim。 */
	readonly decorate?: string;
	readonly subject?: string;
}

const NUL = '\x00';

/**
 * 解析 `git log --graph --format=%x00%H%x00%d%x00%s` 输出为 GraphRow[]。
 * 容错：跳过空行；无 NUL 的行视为 graph 续行。
 */
export function parseGraphLog(output: string): GraphRow[] {
	const rows: GraphRow[] = [];
	for (const line of output.split('\n')) {
		if (line.length === 0) {
			continue;
		}
		const firstNul = line.indexOf(NUL);
		if (firstNul < 0) {
			rows.push({ graph: line.replace(/\s+$/, '') });
			continue;
		}
		const graph = line.slice(0, firstNul).replace(/\s+$/, '');
		const data = line.slice(firstNul + 1).split(NUL);
		rows.push({
			graph,
			hash: data[0]?.trim() || undefined,
			decorate: data[1]?.trim() || undefined,
			subject: data[2] ?? undefined,
		});
	}
	return rows;
}

/** 将所有行的 graph 右填充到最大长度（保证列对齐）。 */
export function normalizeGraphWidth(rows: readonly GraphRow[]): string[] {
	let max = 0;
	for (const r of rows) {
		if (r.graph.length > max) {
			max = r.graph.length;
		}
	}
	return rows.map((r) => r.graph.padEnd(max, ' '));
}

/** 字符 → 渲染类别。 */
export type GraphCharKind = 'node' | 'vert' | 'slash' | 'backslash' | 'underscore' | 'blank';

export function classifyGraphChar(ch: string): GraphCharKind {
	switch (ch) {
		case '*':
			return 'node';
		case '|':
			return 'vert';
		case '/':
			return 'slash';
		case '\\':
			return 'backslash';
		case '_':
			return 'underscore';
		default:
			return 'blank';
	}
}
