import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Commit 视图标题栏控件护栏：changelist 选择（$(checklist) 图标 → QuickPick）与
 * List/Tree 互斥图标（context key hyperGit.commit.tree 驱动显隐）纯由 package.json
 * 贡献点声明，一旦拼写漂移（context key 名、`!` 互斥、槽位排序、palette when），
 * 标题栏按钮即静默消失或常驻双显。此处锁定声明基线，风格对齐 views-layout / menus-guard。
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
		menus: { 'view/title': MenuEntry[]; commandPalette: MenuEntry[] };
	};
}

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8')) as PackageJson;
const commandById = new Map(pkg.contributes.commands.map((c) => [c.command, c]));
const titleEntries = pkg.contributes.menus['view/title'];
const paletteEntries = pkg.contributes.menus.commandPalette;

describe('commit-titlebar（Commit 视图标题栏控件声明护栏）', () => {
	it('四个命令定义齐备：changelist 选择器带 … 与 $(checklist)，List/Tree 图标与 Graph 版一致，批量 Discard 带 $(discard)', () => {
		expect(commandById.get('hyperGit.setActiveChangelist')).toMatchObject({
			title: 'Set Active Changelist…',
			icon: '$(checklist)',
		});
		expect(commandById.get('hyperGit.commit.detailTree')).toMatchObject({
			title: 'Group Changed Files by Directory',
			icon: '$(list-tree)',
		});
		expect(commandById.get('hyperGit.commit.detailFlat')).toMatchObject({
			title: 'Show Changed Files as Flat List',
			icon: '$(list-flat)',
		});
		expect(commandById.get('hyperGit.commit.discardSelected')).toMatchObject({
			title: 'Discard Changes',
			icon: '$(discard)',
		});
	});

	it('view/title 挂载于 Refresh 左侧且 List/Tree 以 hyperGit.commit.tree 互斥，批量 Discard 入 … 菜单', () => {
		const pick = (command: string): MenuEntry => {
			const hit = titleEntries.find(
				(e) => e.command === command && (e.when ?? '').includes('hyperGit.commit'),
			);
			expect(hit, `view/title 缺 ${command}`).toBeDefined();
			return hit!;
		};
		expect(pick('hyperGit.setActiveChangelist')).toEqual({
			command: 'hyperGit.setActiveChangelist',
			when: 'view == hyperGit.commit',
			group: 'navigation@0.5',
		});
		expect(pick('hyperGit.commit.detailTree')).toEqual({
			command: 'hyperGit.commit.detailTree',
			when: 'view == hyperGit.commit && !hyperGit.commit.tree',
			group: 'navigation@0.75',
		});
		expect(pick('hyperGit.commit.detailFlat')).toEqual({
			command: 'hyperGit.commit.detailFlat',
			when: 'view == hyperGit.commit && hyperGit.commit.tree',
			group: 'navigation@0.75',
		});
		// 非 navigation 组 → 落入标题栏「…」菜单（排序在 1_sync 同步组之后）。
		expect(pick('hyperGit.commit.discardSelected')).toEqual({
			command: 'hyperGit.commit.discardSelected',
			when: 'view == hyperGit.commit',
			group: '2_changes@0',
		});
	});

	it('commandPalette 三条均限定 Commit 视图聚焦（不全局泄漏）', () => {
		for (const command of [
			'hyperGit.setActiveChangelist',
			'hyperGit.commit.detailTree',
			'hyperGit.commit.detailFlat',
			'hyperGit.commit.discardSelected',
		]) {
			expect(
				paletteEntries.find((e) => e.command === command),
				`commandPalette 缺 ${command}`,
			).toEqual({ command, when: 'view == hyperGit.commit' });
		}
	});
});
