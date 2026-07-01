/**
 * Log 查询构造（纯逻辑，零 vscode 依赖）。
 *
 * 把 {@link LogFilter} + 范围 + 分页翻译为 `git log` 参数向量（含 {@link LOG_GRAPH_FORMAT}），
 * 供 host 侧 `service.execGit(['log', ...buildLogArgs(...)])` 单次取数。服务端维度（author/grep/path）
 * 走 git 参数；客户端维度（mergeMode/date/regex）由 host 经 {@link toClientFilter} + {@link applyClientFilters}
 * 处理。`--topo-order` 为硬性要求（lane 算法依赖拓扑序）；pathspec `-- <path>` 必须置于末尾。
 */

import type { LogFilter } from './log-filter';
import { LOG_GRAPH_FORMAT } from './log-line';

/**
 * 提交范围（工具栏互斥单选）：
 * - `all` = 仅 heads/tags/remotes（`--branches --tags --remotes`），呈现干净的人类历史（默认）。
 *   关键：不使用 `--all`——`--all` 会遍历 `refs/` 下全部引用，把工具注入的内部引用（如
 *   `refs/conductor-checkpoints/*`、`refs/conductor-archive-heads/*`）所携带的游离/陈旧提交也画成
 *   游离泳道污染视图，且 `git fetch --prune` 对这类非 `refs/remotes/*` 引用无效。显式收敛到三大
 *   标准命名空间即可根治。客户端仍据 {@link LogClientFilter.keepCheckpoint} 剔除 checkpoint 自动提交（双保险）。
 * - `current` = 当前分支（HEAD），剔除 checkpoint 自动提交；
 * - `checkpointer` = 全分支（`--all`），保留 checkpoint 自动提交（原始完整视图，含内部 checkpoint 快照）。
 * checkpoint 的保留/剔除由 adapter 层据 scope 注入 `LogClientFilter.keepCheckpoint`，
 * engine query 层仅据本类型决定分支范围，对 checkpoint 概念无感知（职责单一）。
 */
export type LogScope = 'all' | 'current' | 'checkpointer';

/** 分页参数。 */
export interface LogQueryOptions {
	readonly maxCount: number;
	/** `--skip` 偏移（增量加载下一页）；<=0 表示首页。 */
	readonly skip?: number;
}

/**
 * 构造 `git log` 参数向量（不含 `log` 字面量，host 拼接）。
 * 顺序：`--topo-order` → 范围 → 分页 → 服务端过滤 → `--format` → pathspec（末尾）。
 */
export function buildLogArgs(filter: LogFilter | undefined, scope: LogScope, opts: LogQueryOptions): string[] {
	const args: string[] = ['--topo-order'];
	if (scope === 'checkpointer') {
		// 原始完整视图：遍历 refs/ 全部引用，含 conductor 等工具的 checkpoint 快照与归档头。
		args.push('--all');
	} else if (scope === 'all') {
		// 干净视图：仅 heads/tags/remotes，排除 refs/conductor-* 等工具注入的内部引用，
		// 以免其携带的游离/陈旧提交以游离泳道污染人类历史（`--all` 无法排除，prune 亦触不及）。
		args.push('--branches', '--tags', '--remotes');
	}
	args.push(`--max-count=${opts.maxCount}`);
	if (opts.skip && opts.skip > 0) {
		args.push(`--skip=${opts.skip}`);
	}
	if (filter?.author && filter.author.trim()) {
		args.push(`--author=${filter.author.trim()}`);
	}
	if (filter?.grep && filter.grep.trim()) {
		args.push(`--grep=${filter.grep.trim()}`);
	}
	args.push(`--format=${LOG_GRAPH_FORMAT}`);
	// pathspec 必须置于参数末尾。
	if (filter?.path && filter.path.trim()) {
		args.push('--', filter.path.trim());
	}
	return args;
}
