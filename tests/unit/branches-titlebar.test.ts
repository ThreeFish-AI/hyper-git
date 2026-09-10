import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Branches 视图标题栏/右键菜单护栏：Prune 上移导航位（原 Push 图标位）、Push 下放分支右键、
 * Merge… 收入「…」——纯由 package.json 贡献点声明，拼写漂移即静默消失或错位，此处锁定基线，
 * 风格对齐 commit-titlebar / views-layout。
 */

interface CommandDef {
	command: string;
	title?: string;
	icon?: string;
}
interface MenuEntry {
	command?: string;
	when?: string;
	group?: string;
}
interface PackageJson {
	contributes: {
		commands: CommandDef[];
		menus: {
			'view/title': MenuEntry[];
			'view/item/context': MenuEntry[];
			commandPalette: MenuEntry[];
		};
	};
}

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8')) as PackageJson;
const commandById = new Map(pkg.contributes.commands.map((c) => [c.command, c]));
const titleEntries = pkg.contributes.menus['view/title'];
const itemEntries = pkg.contributes.menus['view/item/context'];
const paletteEntries = pkg.contributes.menus.commandPalette;

describe('branches-titlebar（Branches 标题栏/右键菜单声明护栏）', () => {
	it('pushBranch 命令定义齐备：title "Push" 与 $(arrow-up)（同全局 Push 图标）', () => {
		expect(commandById.get('hyperGit.pushBranch')).toMatchObject({
			title: 'Push',
			icon: '$(arrow-up)',
		});
	});

	it('Prune 图标为 $(sync-ignored)，且不与本视图标题栏/右键的删除类 $(trash) 混淆', () => {
		// 注意是过去式 sync-ignored——sync-ignore 不是有效 codicon，会静默渲染为空白方块
		// （id 真实性由 codicon-validity 护栏统一把关）。
		expect(commandById.get('hyperGit.pruneRemotes')?.icon).toBe('$(sync-ignored)');
		// 该图标全扩展唯一：避免与 Refresh/Update Project 等同栏同步类图标、以及删除类图标撞脸。
		const sameIcon = pkg.contributes.commands.filter((c) => c.icon === '$(sync-ignored)').map((c) => c.command);
		expect(sameIcon).toEqual(['hyperGit.pruneRemotes']);
	});

	it('view/title：Prune 上移 navigation@4（原 Push 位），标题栏不再挂全局 Push，Merge… 收入 1_sync 组', () => {
		const branchesEntries = titleEntries.filter((e) => e.when === 'view == hyperGit.branches');
		const byCommand = new Map(branchesEntries.map((e) => [e.command, e]));
		expect(byCommand.get('hyperGit.pruneRemotes')).toEqual({
			command: 'hyperGit.pruneRemotes',
			when: 'view == hyperGit.branches',
			group: 'navigation@4',
		});
		// 原 Push 图标下放分支右键：标题栏不再出现全局 Push 条目。
		expect(byCommand.get('hyperGit.push'), 'Branches 标题栏不应再挂全局 Push').toBeUndefined();
		// Merge… 由 navigation@5 收入「…」（1_sync 组，updateProject 与 New Tag… 之间）。
		expect(byCommand.get('hyperGit.mergeDialog')).toEqual({
			command: 'hyperGit.mergeDialog',
			when: 'view == hyperGit.branches',
			group: '1_sync@2.5',
		});
	});

	it('view/item/context：本地分支右键提供 Push（checkout 之后、Merge 之前），palette 不泄漏', () => {
		expect(
			itemEntries.find(
				(e) =>
					e.command === 'hyperGit.pushBranch' &&
					e.when === 'view == hyperGit.branches && viewItem == hyperGit.branch && !listMultiSelection',
			),
			'分支右键缺 pushBranch 条目',
		).toEqual({
			command: 'hyperGit.pushBranch',
			when: 'view == hyperGit.branches && viewItem == hyperGit.branch && !listMultiSelection',
			group: '1_branch@2',
		});
		expect(paletteEntries.find((e) => e.command === 'hyperGit.pushBranch')).toEqual({
			command: 'hyperGit.pushBranch',
			when: 'false',
		});
	});
});
