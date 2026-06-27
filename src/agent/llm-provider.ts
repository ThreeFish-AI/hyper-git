/**
 * AI 接缝（M5 实现）：模型来源抽象。
 *
 * 这是【最关键】的接缝——未来切换 vscodeLM / byok(Ollama) / 自带 key(openaiCompatible)
 * 的命脉。若现在硬编码 vscode.lm，未来接本地/自带 key 需大面积重构。
 * 现仅定义契约 + Null 实现，零 Copilot 依赖（未启用 AI 用户零负担）。
 */
export type LlmSource = 'vscodeLM' | 'byok' | 'openaiCompatible';

export type LlmAvailabilityState = 'ok' | 'unauthorized' | 'rateLimited' | 'noModel';

export interface LlmAvailability {
	readonly state: LlmAvailabilityState;
}

export interface ILlmProvider {
	readonly sourceId: string;
	availability(): Promise<LlmAvailability>;
	// M5: stream(messages, token): AsyncIterable<string>;
}

/** Null 实现：AI 未启用。 */
export class NullLlmProvider implements ILlmProvider {
	readonly sourceId = 'null';

	async availability(): Promise<LlmAvailability> {
		return { state: 'noModel' };
	}
}
