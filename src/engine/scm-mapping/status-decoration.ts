import { FileStatus } from '../model';

/**
 * 文件状态 → 装饰描述（letter 角标 + ThemeColor id + faded/strikeThrough）。
 *
 * 复用 VS Code 内置 git 扩展贡献的 `gitDecoration.*` 主题色 token，
 * 保证与原生 Source Control 视图及深色模式视觉一致（复用驱动，不新造 token）。
 */
export interface StatusDecoration {
	readonly letter: string;
	readonly themeColor: string;
	readonly faded?: boolean;
	readonly strikeThrough?: boolean;
}

const MAP: Record<FileStatus, StatusDecoration> = {
	[FileStatus.Modified]: { letter: 'M', themeColor: 'gitDecoration.modifiedResourceForeground' },
	[FileStatus.Added]: { letter: 'A', themeColor: 'gitDecoration.addedResourceForeground' },
	[FileStatus.Deleted]: { letter: 'D', themeColor: 'gitDecoration.deletedResourceForeground', strikeThrough: true },
	[FileStatus.Untracked]: { letter: 'U', themeColor: 'gitDecoration.untrackedResourceForeground', faded: true },
	[FileStatus.Renamed]: { letter: 'R', themeColor: 'gitDecoration.renamedResourceForeground' },
	[FileStatus.Copied]: { letter: 'C', themeColor: 'gitDecoration.copiedResourceForeground' },
	[FileStatus.Conflict]: { letter: '!', themeColor: 'gitDecoration.conflictResourceForeground' },
	[FileStatus.Ignored]: { letter: 'I', themeColor: 'gitDecoration.ignoredResourceForeground', faded: true },
};

const FALLBACK: StatusDecoration = { letter: '?', themeColor: 'gitDecoration.modifiedResourceForeground' };

export function getDecoration(status: FileStatus): StatusDecoration {
	return MAP[status] ?? FALLBACK;
}
