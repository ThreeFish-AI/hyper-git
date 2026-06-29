/**
 * 单个 commit 变更文件解析（纯逻辑，零 vscode 依赖）。
 *
 * 解析 `git diff-tree --no-commit-id --name-status -r [--root] <hash>` 输出为结构化变更列表，
 * 供 Log 提交详情面板展开显示该 commit 改动的文件（IDEA Log → commit → changed files 等价）。
 * status 列含相似度时形如 R100/C90（rename/copy），路径列对 rename/copy 为 "old -> new"。
 */

export interface CommitFileChange {
	/** 变更状态码：A/M/D/T/Rxx/Cxx/U 等。 */
	readonly status: string;
	/** 变更后路径（rename/copy 为新路径）。 */
	readonly path: string;
	/** rename/copy 的原路径。 */
	readonly oldPath?: string;
}

/** 状态码语义（用于展示首字母）。 */
export function statusLabel(status: string): string {
	if (status.startsWith('R')) {
		return 'R';
	}
	if (status.startsWith('C')) {
		return 'C';
	}
	return status;
}

/**
 * 解析 `git diff-tree --name-status -r` 输出为 CommitFileChange[]。
 * 容错：跳过空行与无 tab 的非法行。
 */
export function parseNameStatus(output: string): CommitFileChange[] {
	const result: CommitFileChange[] = [];
	for (const line of output.split('\n')) {
		if (line.length === 0) {
			continue;
		}
		const tabIdx = line.indexOf('\t');
		if (tabIdx < 0) {
			continue;
		}
		const status = line.slice(0, tabIdx);
		const rest = line.slice(tabIdx + 1);
		if (status.length === 0 || rest.length === 0) {
			continue;
		}
		if (status.startsWith('R') || status.startsWith('C')) {
			const arrow = rest.split(' -> ');
			if (arrow.length === 2) {
				result.push({ status, oldPath: arrow[0], path: arrow[1] });
				continue;
			}
		}
		result.push({ status, path: rest });
	}
	return result;
}
