/**
 * AI 接缝（M5 实现）：提交信息生成。
 *
 * 输入 staged diff（可含历史风格、团队规范、changelist 分组意图），流式输出符合
 * Conventional Commits 的提交信息。当前 Null 实现：不生成（AI 未启用）。
 * 与内置 Copilot 的差异：注入完整 commit 流程上下文 + 回写工作流（M5）。
 */
export interface CommitMessageInput {
	readonly stagedDiff: string;
	readonly recentStyle?: readonly string[];
	readonly convention?: string;
}

export interface CommitMessageResult {
	readonly message: string;
	readonly confidence?: number;
}

export interface ICommitMessageProvider {
	generate(input: CommitMessageInput, onChunk: (chunk: string) => void, token: AbortSignal): Promise<CommitMessageResult>;
}

/** Null 实现：AI 未启用，不生成提交信息。 */
export class NullCommitMessageProvider implements ICommitMessageProvider {
	async generate(_input: CommitMessageInput, _onChunk: (chunk: string) => void, _token: AbortSignal): Promise<CommitMessageResult> {
		return { message: '' };
	}
}
