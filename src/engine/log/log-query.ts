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

/** 提交范围：`all` = 全部分支（`--all`，IDEA 默认）；`current` = 当前分支（HEAD）。 */
export type LogScope = 'all' | 'current';

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
	if (scope === 'all') {
		args.push('--all');
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
