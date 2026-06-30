/**
 * Unified Diff hunk 解析器（纯逻辑，零 vscode 依赖）。
 *
 * 这是 partial / 行级提交的命脉：解析 `git diff` 的 unified diff，切分为文件与 hunk，
 * 并能从「选中的 hunk 子集」重建一个合法 patch 供 `git apply --cached` 暂存（设计参考 JetBrains PartialChangesUtil）。
 */

/** 一个 hunk：对应 `@@ -oldStart,oldCount +newStart,newCount @@ context`。 */
export interface DiffHunk {
	readonly header: string;
	readonly oldStart: number;
	readonly oldCount: number;
	readonly newStart: number;
	readonly newCount: number;
	/** hunk 体（每行以 ' '/'-'/'+'/'\\' 起始）。 */
	readonly body: readonly string[];
}

/** 一个文件的 diff：文件头 + hunks。 */
export interface DiffFile {
	readonly oldPath: string;
	readonly newPath: string;
	/** 文件头行（diff --git / index / --- / +++ 等）。 */
	readonly headerLines: readonly string[];
	readonly hunks: readonly DiffHunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$/;
const BODY_RE = /^[ +\\-]/;

function stripPathPrefix(p: string): string {
	if (p.startsWith('a/') || p.startsWith('b/')) {
		return p.slice(2);
	}
	return p;
}

/**
 * 解析 unified diff 文本为 DiffFile[]（仅保留含 hunk 的文件）。
 */
export function parseUnifiedDiff(diff: string): DiffFile[] {
	const lines = diff.split('\n');
	const files: DiffFile[] = [];
	let i = 0;
	while (i < lines.length) {
		if (!lines[i].startsWith('diff --git ')) {
			i++;
			continue;
		}
		const headerLines: string[] = [lines[i]];
		i++;
		let oldPath = '';
		let newPath = '';
		while (i < lines.length && !HUNK_RE.test(lines[i]) && !lines[i].startsWith('diff --git ')) {
			const line = lines[i];
			if (line.startsWith('--- ')) {
				oldPath = stripPathPrefix(line.slice(4).trim());
			} else if (line.startsWith('+++ ')) {
				newPath = stripPathPrefix(line.slice(4).trim());
			}
			headerLines.push(line);
			i++;
		}
		const hunks: DiffHunk[] = [];
		while (i < lines.length && HUNK_RE.test(lines[i])) {
			const m = lines[i].match(HUNK_RE)!;
			const header = lines[i];
			const oldStart = Number(m[1]);
			const oldCount = m[2] !== undefined ? Number(m[2]) : 1;
			const newStart = Number(m[3]);
			const newCount = m[4] !== undefined ? Number(m[4]) : 1;
			i++;
			const body: string[] = [];
			while (i < lines.length && BODY_RE.test(lines[i])) {
				body.push(lines[i]);
				i++;
			}
			hunks.push({ header, oldStart, oldCount, newStart, newCount, body });
		}
		if (hunks.length > 0) {
			files.push({ oldPath, newPath, headerLines, hunks });
		}
	}
	return files;
}

/**
 * 从 DiffFile 中选定的 hunk 重建一个合法 patch（供 `git apply --cached`）。
 * selectedHunkIndices 为该文件 hunks 数组的下标。
 */
export function buildPatch(file: DiffFile, selectedHunkIndices: readonly number[]): string {
	const out: string[] = [...file.headerLines];
	for (const idx of selectedHunkIndices) {
		const h = file.hunks[idx];
		if (h) {
			out.push(h.header);
			out.push(...h.body);
		}
	}
	return out.join('\n') + '\n';
}

/** 仅保留 hunk 体中的「新增」行（去前缀），用于预览/行级提交。 */
export function addedLines(hunk: DiffHunk): readonly string[] {
	return hunk.body.filter((l) => l.startsWith('+')).map((l) => l.slice(1));
}
