/**
 * 提交前检查流水线（有序责任链）。
 *
 * 参考 JetBrains `CheckinHandler.beforeCheckin()` 责任链设计（platform/vcs-api/.../checkin/CheckinHandler.java）：
 * - `CheckinResult` 对应 `CheckinHandler.ReturnResult`（COMMIT / CANCEL / CLOSE_WINDOW→映射为 DEFER）；
 * - `CheckinHook.beforeCheckin` 对应 `beforeCheckin()` 闸门；
 * - `executionOrder` 对应 `CommitCheck.ExecutionOrder`（越小越早，默认 100）。
 *
 * 任一 hook 返回 CANCEL 即阻断提交。M2 起注入内置检查与（M5）AI 审查。
 */
export enum CheckinResult {
	/** 放行提交 */
	Commit = 'COMMIT',
	/** 阻断提交 */
	Cancel = 'CANCEL',
	/** 暂缓（交由调用方决定，如弹确认框） */
	Defer = 'DEFER',
}

export interface CommitInfo {
	readonly message: string;
	readonly filePaths: readonly string[];
}

export interface CheckinHook {
	readonly name: string;
	readonly executionOrder?: number;
	beforeCheckin(info: CommitInfo): Promise<CheckinResult>;
}

export class CommitPipeline {
	private readonly sortedHooks: readonly CheckinHook[];

	constructor(hooks: readonly CheckinHook[] = []) {
		this.sortedHooks = [...hooks].sort((a, b) => (a.executionOrder ?? 100) - (b.executionOrder ?? 100));
	}

	async run(info: CommitInfo): Promise<CheckinResult> {
		for (const hook of this.sortedHooks) {
			const result = await hook.beforeCheckin(info);
			if (result === CheckinResult.Cancel) {
				return CheckinResult.Cancel;
			}
		}
		return CheckinResult.Commit;
	}
}
