/**
 * Log 客户端过滤器（纯逻辑，零 vscode 依赖）。
 *
 * author / path / grep 交给 `git log`（repo.log）服务端过滤；以下维度 git log 稳定 API 不支持或
 * 表达不便，改在客户端对已取回的提交做过滤：合并模式（parents）/ 日期范围（authorDate）/ message 正则。
 * engine 不依赖 vscode，故以 {@link FilterableCommit} 抽象 commit 所需字段，由 adapter 映射。
 */

export type MergeMode = 'all' | 'merge-only' | 'no-merge';

/** 客户端可施加的过滤维度（均为可选，缺省即不过滤）。 */
export interface LogClientFilter {
	readonly mergeMode?: MergeMode;
	/** 起始日期（含），按 authorDate 过滤。 */
	readonly dateFrom?: Date;
	/** 截止日期（含），按 authorDate 过滤。 */
	readonly dateTo?: Date;
	readonly messageRegex?: RegExp;
	/**
	 * 是否保留 Conductor 等 Agent 工具自动创建的 checkpoint 提交（subject 以 `checkpoint:` 开头，见
	 * {@link isCheckpointSubject}）。`false` 时剔除；缺省或 `true` 时保留。由 Log 视图 scope 驱动
	 * （Checkpointer 视图保留完整历史，All/Current 剔除以呈现干净的人类提交历史）。
	 */
	readonly keepCheckpoint?: boolean;
}

/**
 * Log 完整过滤器（单一事实源，engine 层）：author/path/grep 交 git log 服务端；
 * mergeMode/dateFrom/dateTo/messageRegex 客户端（见 {@link toClientFilter}）。
 */
export interface LogFilter {
	readonly author?: string;
	readonly path?: string;
	readonly grep?: string;
	readonly mergeMode?: MergeMode;
	readonly dateFrom?: Date;
	readonly dateTo?: Date;
	/** message 正则模式串（运行时经 {@link safeRegex} 编译）。 */
	readonly messageRegex?: string;
}

/** 从完整过滤器抽取客户端维度（服务端维度交 git log，见 {@link buildLogArgs}）。 */
export function toClientFilter(filter: LogFilter | undefined): LogClientFilter {
	if (!filter) {
		return {};
	}
	return {
		mergeMode: filter.mergeMode,
		dateFrom: filter.dateFrom,
		dateTo: filter.dateTo,
		messageRegex: filter.messageRegex ? safeRegex(filter.messageRegex) : undefined,
	};
}

/** 过滤所需的最小 commit 投影（adapter 由 vscode.git Commit 映射而来）。 */
export interface FilterableCommit {
	readonly message: string;
	readonly authorDate?: Date;
	readonly parents: readonly string[];
}

/** 安全构造 RegExp：空串或非法模式返回 undefined（避免过滤崩溃）。 */
export function safeRegex(pattern: string): RegExp | undefined {
	if (pattern.length === 0) {
		return undefined;
	}
	try {
		return new RegExp(pattern);
	} catch {
		return undefined;
	}
}

/**
 * Conductor 等 Agent 工具自动创建的「状态快照」提交前缀（LangGraph Checkpointer 语义）。
 * 已知模式：`checkpoint:session-<uuid>-turn-<uuid>-start/end`、`checkpoint:conductor-archive-<uuid>`、
 * `checkpoint:conductor-getdiff`。锚定 subject 行首、大小写不敏感；集中于此为单一事实源，
 * adapter / 测试一律引用本常量或谓词，杜绝识别规则分散。
 */
export const CHECKPOINT_SUBJECT_RE = /^checkpoint:/i;

/** 判定提交 subject 是否为 checkpoint 自动提交（{@link CHECKPOINT_SUBJECT_RE} 的谓词封装）。 */
export function isCheckpointSubject(subject: string): boolean {
	return CHECKPOINT_SUBJECT_RE.test(subject);
}

/** 对已取回的提交施加客户端过滤（不可变，返回新数组）。 */
export function applyClientFilters<T extends FilterableCommit>(commits: readonly T[], filter: LogClientFilter): T[] {
	let result: T[] = [...commits];
	// checkpoint 剔除置链首：其高密度特性可减少后续 mergeMode/date/regex 的计算量；
	// 与其他维度同为 AND 语义、可交换，顺序不影响结果正确性。
	if (filter.keepCheckpoint === false) {
		result = result.filter((c) => !isCheckpointSubject(c.message));
	}
	if (filter.mergeMode === 'merge-only') {
		result = result.filter((c) => c.parents.length > 1);
	} else if (filter.mergeMode === 'no-merge') {
		result = result.filter((c) => c.parents.length <= 1);
	}
	if (filter.dateFrom || filter.dateTo) {
		result = result.filter((c) => {
			if (!c.authorDate) {
				return true;
			}
			if (filter.dateFrom && c.authorDate < filter.dateFrom) {
				return false;
			}
			if (filter.dateTo && c.authorDate > filter.dateTo) {
				return false;
			}
			return true;
		});
	}
	if (filter.messageRegex) {
		const re = filter.messageRegex;
		result = result.filter((c) => re.test(c.message));
	}
	return result;
}
