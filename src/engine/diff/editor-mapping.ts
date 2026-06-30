import type { DiffFile, DiffHunk } from './hunk-parser';

/**
 * 一个 hunk 在编辑器（当前工作区文件）中的可见区域。
 *
 * - startLine/endLine：该 hunk 的 new 范围（1-based 编辑器行），用于 CodeLens 定位与背景装饰。
 * - addedLines：hunk 体中「新增行（'+'）」对应的编辑器行号，用于 gutter 新增标记。
 */
export interface EditorRegion {
	readonly hunkIndex: number;
	readonly startLine: number;
	readonly endLine: number;
	readonly addedLines: readonly number[];
	readonly addedCount: number;
	readonly removedCount: number;
}

/**
 * 把 DiffFile 的每个 hunk 映射为编辑器区域（设计参考 JetBrains LineStatusTracker 的纯逻辑实现）。
 */
export function mapFileToEditorRegions(file: DiffFile): EditorRegion[] {
	return file.hunks.map((h, i) => mapHunkToRegion(h, i));
}

function mapHunkToRegion(hunk: DiffHunk, hunkIndex: number): EditorRegion {
	const startLine = hunk.newStart;
	const endLine = hunk.newStart + Math.max(hunk.newCount, 1) - 1;
	const addedLines: number[] = [];
	let added = 0;
	let removed = 0;
	let newLine = hunk.newStart;
	for (const body of hunk.body) {
		const prefix = body[0];
		if (prefix === '+') {
			addedLines.push(newLine);
			added++;
			newLine++;
		} else if (prefix === ' ') {
			newLine++;
		} else if (prefix === '-') {
			removed++;
		}
	}
	return { hunkIndex, startLine, endLine, addedLines, addedCount: added, removedCount: removed };
}
