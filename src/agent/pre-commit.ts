import type { CheckinHook } from '../engine/commit/pipeline';

/**
 * AI 接缝（M5 实现）：提交前审查。
 *
 * 对齐 IntelliJ IDEA `CheckinHandler.beforeCheckin()` / `CommitCheck.runCheck()`——
 * 挂载到 CommitPipeline 责任链，可返回 COMMIT 放行或 CANCEL 阻断不良提交。
 * 现仅定义契约；M2 起接入内置非 AI 检查（TODO/reformat），M5 起接入 AI 代码审查。
 */
export interface InspectionProblem {
	readonly file: string;
	readonly line?: number;
	readonly severity: 'info' | 'warning' | 'error';
	readonly message: string;
	readonly suggestion?: string;
}

export interface InspectionResult {
	readonly pass: boolean;
	readonly problems: readonly InspectionProblem[];
	readonly blockCommit: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- AI 接缝占位：M5 补充 inspect() 等方法
export interface IPreCommitInspector extends CheckinHook {
	// M5: inspect(input: { stagedFiles; diff; context }): Promise<InspectionResult>;
}
