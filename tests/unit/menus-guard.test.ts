import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 清单守护测试：锁定 package.json 贡献点中三类易回归的规范。
 * 1. `viewItem =~` 正则必须 ^…$ 锚定——未锚定正则会误匹配包含子串的 contextValue
 *    （如 `hyperGit.branchFolder` 命中 `/hyperGit.branch|…/`，文件夹行出现分支菜单）。
 * 2. 全部 contributes.settings 必须声明 scope——未声明的设置在 User/Workspace 层级语义不明。
 * 3. 可见视图必须声明 contextualTitle——视图拖出容器为独立面板时标题不退化为视图名。
 */

interface PackageJson {
	contributes: {
		menus: Record<string, Array<{ when?: string }>>;
		views: Record<string, Array<{ id: string; contextualTitle?: string; when?: string }>>;
		configuration: { properties: Record<string, { scope?: string }> };
	};
}

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as PackageJson;

function allWhenClauses(): string[] {
	const clauses: string[] = [];
	for (const entries of Object.values(pkg.contributes.menus)) {
		for (const entry of entries) {
			if (entry.when) {
				clauses.push(entry.when);
			}
		}
	}
	return clauses;
}

describe('menus-guard（清单守护）', () => {
	it('所有 viewItem =~ 正则必须 ^…$ 锚定', () => {
		const offenders: string[] = [];
		for (const when of allWhenClauses()) {
			const match = when.match(/viewItem =~ \/([^/]+)\//);
			if (match && !match[1].startsWith('^')) {
				offenders.push(when);
			}
			if (match && !match[1].endsWith('$')) {
				offenders.push(when);
			}
		}
		expect(offenders, `未锚定的 viewItem 正则: ${offenders.join(' | ')}`).toEqual([]);
	});

	it('全部设置项必须声明 scope', () => {
		const missing = Object.keys(pkg.contributes.configuration.properties).filter(
			(key) => !pkg.contributes.configuration.properties[key].scope,
		);
		expect(missing, `缺 scope 的设置: ${missing.join(', ')}`).toEqual([]);
	});

	it('可见视图必须声明 contextualTitle', () => {
		const missing: string[] = [];
		for (const views of Object.values(pkg.contributes.views)) {
			for (const view of views) {
				// when:false 的隐藏承载视图（changesBadge）豁免。
				if (view.when === 'false') {
					continue;
				}
				if (!view.contextualTitle) {
					missing.push(view.id);
				}
			}
		}
		expect(missing, `缺 contextualTitle 的视图: ${missing.join(', ')}`).toEqual([]);
	});

	it('扩展声明 extensionKind=workspace（依赖本地 git，须跑在工作区侧）', () => {
		const raw = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as { extensionKind?: string[] };
		expect(raw.extensionKind).toEqual(['workspace']);
	});

	it('非受信工作区显式声明不支持（扩展会执行 commit/push/discard）', () => {
		const raw = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
			capabilities: { untrustedWorkspaces?: { supported?: boolean } };
		};
		expect(raw.capabilities.untrustedWorkspaces?.supported).toBe(false);
	});
});
