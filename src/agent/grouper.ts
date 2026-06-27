/**
 * AI 接缝（M5 实现）：变更语义分组（自动 changelist 归类）。
 *
 * 输入全部变更文件 + diff 摘要，输出建议的 changelist 分组（可一键应用回 changelist 模型）。
 * 当前 Null 实现：不分组。
 */
export interface GroupSuggestion {
	readonly name: string;
	readonly filePaths: readonly string[];
	readonly reason?: string;
	readonly suggestedMessage?: string;
}

export interface IChangelistGrouper {
	suggest(input: { readonly files: ReadonlyArray<{ readonly path: string; readonly diffSummary?: string }> }): Promise<GroupSuggestion[]>;
}

/** Null 实现：AI 未启用，不分组。 */
export class NullChangelistGrouper implements IChangelistGrouper {
	async suggest(): Promise<GroupSuggestion[]> {
		return [];
	}
}
