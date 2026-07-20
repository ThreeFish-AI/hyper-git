import { describe, it, expect } from 'vitest';
import pkg from '../../package.json';

/**
 * 面板视图默认布局护栏：`contributes.views["hyper-git"]` 的声明顺序与各视图
 * `visibility` 纯由 package.json 驱动（`src/` 无代码断言/依赖），一旦被误改，
 * 用户可见的默认排序与显隐即随之漂移。此处锁定「设计基线」，呼应本仓
 * `--topo-order` 回归护栏文化。语义见 docs/.agents/issue.md #16（决策）/ #12（平台约束）。
 */

/** VS Code view descriptor 的最小子集（仅取本护栏关心的字段）。 */
interface ViewDescriptor {
	id: string;
	visibility?: string;
	when?: string;
}

const views = pkg.contributes.views['hyper-git'] as unknown as ViewDescriptor[];
/** 用户可见视图 = 排除 `when:false` 的角标承载视图（changesBadge，永不渲染）。 */
const userViews = views.filter((v) => v.when !== 'false');

describe('Hyper Git 面板视图默认布局（package.json 声明式护栏）', () => {
	it('用户可见视图声明顺序固定为 Commit·Branches·Graph·Worktrees·Stash·Shelf', () => {
		expect(userViews.map((v) => v.id)).toEqual([
			'hyperGit.commit',
			'hyperGit.branches',
			'hyperGit.log',
			'hyperGit.worktrees',
			'hyperGit.stash',
			'hyperGit.shelf',
		]);
	});

	it('各视图默认 visibility 符合设计（Commit/Worktrees 折叠、Branches/Graph 展开、Stash/Shelf 隐藏）', () => {
		const visibilityById = Object.fromEntries(userViews.map((v) => [v.id, v.visibility]));
		expect(visibilityById).toEqual({
			'hyperGit.commit': 'collapsed',
			'hyperGit.branches': 'visible',
			'hyperGit.log': 'visible',
			'hyperGit.worktrees': 'collapsed',
			'hyperGit.stash': 'hidden',
			'hyperGit.shelf': 'hidden',
		});
	});

	it('changesBadge 为 when:false 的隐藏角标承载视图，且恒定末位', () => {
		const badge = views.find((v) => v.id === 'hyperGit.changesBadge');
		expect(badge?.when).toBe('false');
		expect(badge?.visibility).toBeUndefined();
		expect(views[views.length - 1].id).toBe('hyperGit.changesBadge');
	});
});
