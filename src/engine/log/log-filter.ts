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

/** 对已取回的提交施加客户端过滤（不可变，返回新数组）。 */
export function applyClientFilters<T extends FilterableCommit>(commits: readonly T[], filter: LogClientFilter): T[] {
	let result: T[] = [...commits];
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
