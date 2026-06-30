/**
 * Engine 层领域模型（纯逻辑，零 vscode 依赖，可被 Vitest 与未来 CLI 双复用）。
 *
 * FileStatus 与 vscode.git 的 Status 枚举语义对齐（INDEX 系列、工作区、冲突），
 * 但作为本扩展自有领域模型独立定义，避免 Engine 层反向依赖 vscode。
 */

/** 文件变更状态。字母值对应 VS Code 文件状态色约定（着色语义参考 JetBrains 文件状态色）。 */
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

const FILE_STATUS_LABELS: Record<FileStatus, string> = {
	[FileStatus.Modified]: 'Modified',
	[FileStatus.Added]: 'Added',
	[FileStatus.Deleted]: 'Deleted',
	[FileStatus.Untracked]: 'Untracked',
	[FileStatus.Renamed]: 'Renamed',
	[FileStatus.Copied]: 'Copied',
	[FileStatus.Conflict]: 'Conflict',
	[FileStatus.Ignored]: 'Ignored',
};

/** 文件状态的可读名（用于 tooltip 等展示）。 */
export function fileStatusLabel(status: FileStatus): string {
	return FILE_STATUS_LABELS[status] ?? 'Unknown';
}

/** 单个文件的变更。uri 为仓库相对路径；rename/copy 时 oldUri 为源路径。 */
export interface FileChange {
	readonly uri: string;
	readonly status: FileStatus;
	readonly oldUri?: string;
}

/** 命名变更列表（参考 JetBrains LocalChangeList 设计）。active 列表为新改动默认落入目标。 */
export interface Changelist {
	readonly id: string;
	readonly name: string;
	readonly active: boolean;
	readonly description?: string;
	readonly changes: readonly FileChange[];
}
