import { CheckinResult } from '../engine/commit/pipeline';
import type { CheckinHook } from '../engine/commit/pipeline';

/**
 * AI 接缝（M5 实现）：提交前审查。
 *
 * 参考 JetBrains `CheckinHandler.beforeCheckin()` / `CommitCheck.runCheck()` 责任链设计——
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

/** Null 实现：AI 未启用，提交前检查恒放行。 */
export class NullPreCommitInspector implements IPreCommitInspector {
	readonly name = 'null-pre-commit-inspector';
	readonly executionOrder = 100;

	async beforeCheckin(): Promise<CheckinResult> {
		return CheckinResult.Commit;
	}
}
