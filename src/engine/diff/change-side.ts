/**
 * 变更文件 → 差异端点形态（纯逻辑，零 vscode 依赖，可被 Vitest 与未来 CLI 双复用）。
 *
 * 「打开差异」需为左（旧）/右（新）两端各取一个内容源。当一端在对应 ref 下不存在（新增文件无旧端、
 * 删除文件无新端）时，若仍对不存在对象取具名 ref（'HEAD' / `${hash}^`），较新 VS Code 的 git
 * FileSystemProvider.readFile 会抛 FileNotFound 致差异打不开（见 issue.md）。故先把「变更状态」正交地
 * 归约为 DiffShape，再由 adapter 层据此决定哪一端置空（git 空树 ref）。
 */

import { FileStatus } from '../model';

/** 差异端点形态：决定左右两端如何取（新增置空旧端 / 删除置空新端 / 重命名两端异路径 / 修改两端同路径）。 */
export type DiffShape = 'added' | 'deleted' | 'renamed' | 'modified';

/**
 * 领域模型状态（Commit 视图，来自 vscode.git 映射）→ 差异形态。
 * Copied 归为 added：工作区 copy 的源路径不可靠，置空旧端最稳妥（回落为「全新增」对比）。
 */
export function diffShapeFromStatus(status: FileStatus): DiffShape {
	switch (status) {
		case FileStatus.Added:
		case FileStatus.Untracked:
		case FileStatus.Copied:
			return 'added';
		case FileStatus.Deleted:
			return 'deleted';
		case FileStatus.Renamed:
			return 'renamed';
		default:
			// Modified / Conflict / Ignored 等：两端同路径取真实内容对比。
			return 'modified';
	}
}

/**
 * git diff-tree 字母状态码（Graph 视图，形如 A / M / D / R100 / C90 / T / U）→ 差异形态。
 * 取首字母判定；C（copy）在 diff-tree 输出里携带可靠 oldPath，故按 renamed 处理（源↔目标内容对比）。
 */
export function diffShapeFromCode(code: string): DiffShape {
	switch (code[0]) {
		case 'A':
		case 'U':
			return 'added';
		case 'D':
			return 'deleted';
		case 'R':
		case 'C':
			return 'renamed';
		default:
			// M（modified）/ T（type-changed）/ 其它：两端同路径取真实内容对比。
			return 'modified';
	}
}
