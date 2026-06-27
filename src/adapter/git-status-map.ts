import { FileStatus } from '../engine/model';

/**
 * vscode.git `Status` 枚举数值镜像（单一事实源）。
 *
 * 原枚举为 git.d.ts 中的 `const enum`，esbuild 打包 `.d.ts` 时无法在运行时取值，
 * 故在此以普通 const 对象镜像其数值（与 extensions/git/src/api/git.d.ts 严格一致）。
 */
export const GitStatus = {
	INDEX_MODIFIED: 0,
	INDEX_ADDED: 1,
	INDEX_DELETED: 2,
	INDEX_RENAMED: 3,
	INDEX_COPIED: 4,

	MODIFIED: 5,
	DELETED: 6,
	UNTRACKED: 7,
	IGNORED: 8,
	INTENT_TO_ADD: 9,
	INTENT_TO_RENAME: 10,
	TYPE_CHANGED: 11,

	ADDED_BY_US: 12,
	ADDED_BY_THEM: 13,
	DELETED_BY_US: 14,
	DELETED_BY_THEM: 15,
	BOTH_ADDED: 16,
	BOTH_DELETED: 17,
	BOTH_MODIFIED: 18,
} as const;
export type GitStatus = (typeof GitStatus)[keyof typeof GitStatus];

/** vscode.git Status 数值 → 本扩展 FileStatus 领域模型（纯函数）。 */
export function mapGitStatus(status: number): FileStatus {
	switch (status) {
		case GitStatus.INDEX_MODIFIED:
		case GitStatus.MODIFIED:
		case GitStatus.TYPE_CHANGED:
		case GitStatus.INTENT_TO_ADD:
			return FileStatus.Modified;
		case GitStatus.INDEX_ADDED:
		case GitStatus.ADDED_BY_US:
			return FileStatus.Added;
		case GitStatus.INDEX_DELETED:
		case GitStatus.DELETED:
		case GitStatus.DELETED_BY_US:
		case GitStatus.DELETED_BY_THEM:
			return FileStatus.Deleted;
		case GitStatus.UNTRACKED:
			return FileStatus.Untracked;
		case GitStatus.INDEX_RENAMED:
		case GitStatus.INTENT_TO_RENAME:
			return FileStatus.Renamed;
		case GitStatus.INDEX_COPIED:
			return FileStatus.Copied;
		case GitStatus.IGNORED:
			return FileStatus.Ignored;
		case GitStatus.BOTH_ADDED:
		case GitStatus.BOTH_DELETED:
		case GitStatus.BOTH_MODIFIED:
		case GitStatus.ADDED_BY_THEM:
			return FileStatus.Conflict;
		default:
			return FileStatus.Modified;
	}
}
