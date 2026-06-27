/**
 * Engine 层领域模型（纯逻辑，零 vscode 依赖，可被 Vitest 与未来 CLI 双复用）。
 *
 * FileStatus 与 vscode.git 的 Status 枚举语义对齐（INDEX 系列、工作区、冲突），
 * 但作为本扩展自有领域模型独立定义，避免 Engine 层反向依赖 vscode。
 */

/** 文件变更状态。字母值对齐 IDEA / VS Code 文件状态色约定。 */
export enum FileStatus {
	Modified = 'M',
	Added = 'A',
	Deleted = 'D',
	Untracked = 'U',
	Renamed = 'R',
	Copied = 'C',
	Conflict = '!',
	Ignored = 'I',
}

/** 单个文件的变更。uri 为仓库相对路径；rename/copy 时 oldUri 为源路径。 */
export interface FileChange {
	readonly uri: string;
	readonly status: FileStatus;
	readonly oldUri?: string;
}

/** 命名变更列表（仿 IDEA LocalChangeList）。active 列表为新改动默认落入目标。 */
export interface Changelist {
	readonly id: string;
	readonly name: string;
	readonly active: boolean;
	readonly description?: string;
	readonly changes: readonly FileChange[];
}
