import { describe, it, expect } from 'vitest';
import { mapFileToEditorRegions } from '../../src/engine/diff/editor-mapping';
import { parseUnifiedDiff } from '../../src/engine/diff/hunk-parser';

const DIFF = `diff --git a/x.txt b/x.txt
index 1..2 100644
--- a/x.txt
+++ b/x.txt
@@ -1,3 +1,5 @@
 ctx1
-old1
+new1
+new2
 ctx2
@@ -10,2 +12,3 @@
 ctx10
-old10
+new10a
+new10b
+new10c
`;

describe('mapFileToEditorRegions', () => {
	it('每个 hunk 映射为一个 region', () => {
		const file = parseUnifiedDiff(DIFF)[0];
		const regions = mapFileToEditorRegions(file);
		expect(regions).toHaveLength(2);
	});

	it('正确计算 new 范围行号', () => {
		const regions = mapFileToEditorRegions(parseUnifiedDiff(DIFF)[0]);
		expect(regions[0]).toMatchObject({ startLine: 1, endLine: 5 });
		expect(regions[1]).toMatchObject({ startLine: 12, endLine: 14 });
	});

	it('addedLines 仅含 + 行的编辑器行号', () => {
		const regions = mapFileToEditorRegions(parseUnifiedDiff(DIFF)[0]);
		// hunk0: ctx1(1) old1-> +new1(2) +new2(3) ctx2(4) ... newStart=1
		// +new1 at line 2, +new2 at line 3
		expect(regions[0].addedLines).toEqual([2, 3]);
		// hunk1: newStart=12: ctx10(12) +new10a(13) +new10b(14) +new10c(15)
		expect(regions[1].addedLines).toEqual([13, 14, 15]);
	});

	it('addedCount / removedCount 统计', () => {
		const regions = mapFileToEditorRegions(parseUnifiedDiff(DIFF)[0]);
		expect(regions[0]).toMatchObject({ addedCount: 2, removedCount: 1 });
		expect(regions[1]).toMatchObject({ addedCount: 3, removedCount: 1 });
	});

	it('hunkIndex 与文件 hunks 下标一致', () => {
		const regions = mapFileToEditorRegions(parseUnifiedDiff(DIFF)[0]);
		expect(regions.map((r) => r.hunkIndex)).toEqual([0, 1]);
	});
});
