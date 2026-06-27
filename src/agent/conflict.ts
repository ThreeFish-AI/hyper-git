/**
 * AI 接缝（M5 实现）：冲突解决助手。
 *
 * 输入三方冲突（ours/theirs/base），输出建议的合并结果（可逐块采纳）。
 * 安全红线：必须用户逐块确认，不可自动写入（对齐 VS Code 工具 prepareInvocation 确认机制）。
 */
export interface ConflictResolution {
	readonly hunk: string;
	readonly suggested: string;
	readonly confidence?: number;
	readonly reason?: string;
}

export interface IConflictResolver {
	suggest(input: { readonly ours: string; readonly theirs: string; readonly base: string }): Promise<ConflictResolution[]>;
}

/** Null 实现：AI 未启用，不提供冲突建议。 */
export class NullConflictResolver implements IConflictResolver {
	async suggest(): Promise<ConflictResolution[]> {
		return [];
	}
}
