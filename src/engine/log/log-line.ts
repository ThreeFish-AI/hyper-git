/**
 * `git log`（Graph 数据源）输出解析器（纯逻辑，零 vscode 依赖）。
 *
 * 一次性 NUL/RS 分隔格式取全字段（含 parents），供自计算 DAG lane 布局（{@link ../graph-layout}）
 * 替代旧 `git log --graph` ASCII 路径。配套 CLI（字段以 NUL `%x00` 分隔、记录以 RS `%x1e` 终止，
 * 二者均不会出现在 git 文本输出中，规避多行 subject 歧义）：
 *
 *   git log --topo-order [--all] --max-count=<N> [--skip=<cursor>] [--author --grep -- <path>]
 *          --format=<LOG_GRAPH_FORMAT>
 *
 * `--topo-order` 为硬性要求：lane 增量算法依赖「子在父之上」严格成立。
 */

/** for-each commit 的 --format 值（与 {@link parseLogLines} 字段顺序严格对应，勿单独修改）。 */
export const LOG_GRAPH_FORMAT = '%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x1e';

/** 一条 commit 的解析结果（字段顺序对应 {@link LOG_GRAPH_FORMAT}）。 */
export interface RawCommit {
	readonly hash: string;
	/** 有序父 hash（`%P` 空格分隔；root 为空数组）。 */
	readonly parents: readonly string[];
	readonly authorName: string;
	readonly authorEmail: string;
	/** 作者日期 ISO 严格（`%aI`，`new Date()` 可解析）。 */
	readonly authorDate: string;
	/** subject（`%s`，首行）。 */
	readonly subject: string;
}

const NUL = '\x00';
const RS = '\x1e';

/**
 * 解析 `git log --format=<LOG_GRAPH_FORMAT>` 输出为 RawCommit[]。
 * 容错：跳过空记录与字段不足的记录（避免单条异常中断整个视图）。
 */
export function parseLogLines(output: string): RawCommit[] {
	const commits: RawCommit[] = [];
	for (let record of output.split(RS)) {
		record = record.replace(/^\r?\n/, ''); // 去除 git 逐 commit 追加的行首换行
		if (record.length === 0) {
			continue;
		}
		const f = record.split(NUL);
		if (f.length < 6) {
			continue;
		}
		const hash = f[0];
		if (!hash) {
			continue;
		}
		commits.push({
			hash,
			parents: f[1].split(' ').filter(Boolean),
			authorName: f[2] ?? '',
			authorEmail: f[3] ?? '',
			authorDate: f[4] ?? '',
			subject: f[5] ?? '',
		});
	}
	return commits;
}
