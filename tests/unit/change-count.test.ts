import { describe, it, expect } from 'vitest';
import { countUniqueChanges, toRelKey } from '../../src/engine/scm-mapping/change-count';

/** 构造最小 change：仅携带 uri.fsPath（countUniqueChanges 只读该字段）。 */
const c = (fsPath: string): { uri: { fsPath: string } } => ({ uri: { fsPath } });

const ROOT = '/repo';

/** 参考实现：镜像 GitRepositoryService.getChanges() 的去重（Map first-wins），用于锁定计数等值不变式。 */
function refCount(root: string, ...groups: ReadonlyArray<ReadonlyArray<{ uri: { fsPath: string } }>>): number {
	const map = new Map<string, unknown>();
	for (const g of groups) {
		for (const ch of g) {
			const rel = toRelKey(root, ch.uri.fsPath);
			if (!map.has(rel)) {
				map.set(rel, ch);
			}
		}
	}
	return map.size;
}

describe('toRelKey', () => {
	it('绝对路径 → 仓库相对 posix 路径', () => {
		expect(toRelKey(ROOT, '/repo/src/a.ts')).toBe('src/a.ts');
		expect(toRelKey(ROOT, '/repo/README.md')).toBe('README.md');
	});

	it('嵌套目录保留层级', () => {
		expect(toRelKey(ROOT, '/repo/a/b/c/d.ts')).toBe('a/b/c/d.ts');
	});
});

describe('countUniqueChanges', () => {
	it('空 → 0', () => {
		expect(countUniqueChanges(ROOT)).toBe(0);
		expect(countUniqueChanges(ROOT, [], [], [])).toBe(0);
	});

	it('单组不相交 → 条目数', () => {
		expect(countUniqueChanges(ROOT, [c('/repo/a.ts'), c('/repo/b.ts')])).toBe(2);
	});

	it('三组不相交 → 求和', () => {
		const index = [c('/repo/a.ts')];
		const work = [c('/repo/b.ts'), c('/repo/c.ts')];
		const untracked = [c('/repo/d.ts')];
		expect(countUniqueChanges(ROOT, index, work, untracked)).toBe(4);
	});

	it('跨组同路径（暂存+改动同文件）→ 去重为 1', () => {
		const index = [c('/repo/src/x.ts')];
		const work = [c('/repo/src/x.ts')];
		expect(countUniqueChanges(ROOT, index, work)).toBe(1);
	});

	it('组内重复路径 → 去重', () => {
		expect(countUniqueChanges(ROOT, [c('/repo/a.ts'), c('/repo/a.ts')])).toBe(1);
	});

	it('计数与 getChanges 去重语义严格相等（混合重叠夹具）', () => {
		const index = [c('/repo/a.ts'), c('/repo/shared.ts')];
		const work = [c('/repo/b.ts'), c('/repo/shared.ts'), c('/repo/dir/c.ts')];
		const untracked = [c('/repo/dir/c.ts'), c('/repo/new.ts')];
		expect(countUniqueChanges(ROOT, index, work, untracked)).toBe(refCount(ROOT, index, work, untracked));
		// 唯一路径：a, shared, b, dir/c, new = 5
		expect(countUniqueChanges(ROOT, index, work, untracked)).toBe(5);
	});
});
