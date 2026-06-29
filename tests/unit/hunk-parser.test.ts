import { describe, it, expect } from 'vitest';
import { addedLines, buildPatch, parseUnifiedDiff } from '../../src/engine/diff/hunk-parser';

const SAMPLE = `diff --git a/foo.txt b/foo.txt
index 111..222 100644
--- a/foo.txt
+++ b/foo.txt
@@ -1,3 +1,4 @@
 line1
-old line
+new line
+added
 line3
@@ -10,2 +11,2 @@
 line10
-old10
+new10
diff --git a/bar.bin b/bar.bin
Binary files differ
`;

describe('parseUnifiedDiff', () => {
	it('解析单文件多 hunk，跳过二进制文件', () => {
		const files = parseUnifiedDiff(SAMPLE);
		expect(files).toHaveLength(1);
		const f = files[0];
		expect(f.oldPath).toBe('foo.txt');
		expect(f.newPath).toBe('foo.txt');
		expect(f.hunks).toHaveLength(2);
	});

	it('正确解析 hunk 的行号与计数', () => {
		const f = parseUnifiedDiff(SAMPLE)[0];
		expect(f.hunks[0]).toMatchObject({ oldStart: 1, oldCount: 3, newStart: 1, newCount: 4 });
		expect(f.hunks[1]).toMatchObject({ oldStart: 10, oldCount: 2, newStart: 11, newCount: 2 });
	});

	it('支持省略计数（@@ -1 +1 @@）', () => {
		const files = parseUnifiedDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -5 +5 @@\n-a\n+b\n');
		expect(files[0].hunks[0]).toMatchObject({ oldStart: 5, oldCount: 1, newStart: 5, newCount: 1 });
	});

	it('hunk body 不越界吞掉下一个文件/diff', () => {
		const f = parseUnifiedDiff(SAMPLE)[0];
		expect(f.hunks[1].body).toEqual([' line10', '-old10', '+new10']);
	});
});

describe('buildPatch', () => {
	it('仅含选中 hunk + 文件头', () => {
		const f = parseUnifiedDiff(SAMPLE)[0];
		const patch = buildPatch(f, [0]);
		expect(patch).toContain('diff --git a/foo.txt b/foo.txt');
		expect(patch).toContain('@@ -1,3 +1,4 @@');
		expect(patch).toContain('+added');
		expect(patch).not.toContain('@@ -10,2 +11,2 @@');
		expect(patch).not.toContain('+new10');
	});

	it('选中多个 hunk', () => {
		const f = parseUnifiedDiff(SAMPLE)[0];
		const patch = buildPatch(f, [0, 1]);
		expect(patch).toContain('@@ -1,3 +1,4 @@');
		expect(patch).toContain('@@ -10,2 +11,2 @@');
	});
});

describe('addedLines', () => {
	it('提取新增行（去前缀）', () => {
		const f = parseUnifiedDiff(SAMPLE)[0];
		expect(addedLines(f.hunks[0])).toEqual(['new line', 'added']);
	});
});
