import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 图标名有效性护栏：`icon` 写成不存在的 codicon id 时 VS Code **静默渲染为空白方块**——
 * 无告警、无报错，只有实机肉眼可见（曾漏出 `$(sync-ignore)`（正确为 `sync-ignored`）
 * 与 `$(compare)`（正确为 `git-compare`）两例）。此处以官方 codicon 库 id 白名单锁定基线。
 *
 * 白名单取自 microsoft/vscode-codicons 的 `src/template/mapping.json`（码位→别名，含全部别名），
 * 仅收录本扩展在用的子集；新增图标时若此处缺失，先对照官方列表确认 id 真实存在再补入：
 * https://code.visualstudio.com/api/references/icons-in-labels
 */
const VALID_CODICONS: ReadonlySet<string> = new Set([
	'add',
	'archive',
	'arrow-down',
	'arrow-right',
	'arrow-up',
	'check',
	'checklist',
	'clear-all',
	'clock',
	'cloud-upload',
	'diff',
	'diff-ignored',
	'discard',
	'edit',
	'eye',
	'filter',
	'folder-opened',
	'gear',
	'git-branch',
	'git-compare',
	'git-merge',
	'history',
	'inbox',
	'layers',
	'list-flat',
	'list-tree',
	'lock',
	'output',
	'refresh',
	'repo',
	'repo-fetch',
	'repo-pull',
	'repo-push',
	'sign-in',
	'star-full',
	'sync',
	'sync-ignored',
	'tag',
	'trash',
]);

interface CommandDef {
	command: string;
	icon?: unknown;
}
interface PackageJson {
	contributes: { commands: CommandDef[]; submenus?: { id: string; icon?: unknown }[] };
}

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8')) as PackageJson;
const ICON_RE = /^\$\(([a-z0-9-]+)\)$/;

describe('codicon-validity（图标名有效性护栏）', () => {
	it('所有命令图标均为 $(codicon) 形态且 id 真实存在（无效 id 会静默渲染空白）', () => {
		const invalid = pkg.contributes.commands
			.filter((c): c is CommandDef & { icon: string } => typeof c.icon === 'string')
			.filter((c) => {
				const id = ICON_RE.exec(c.icon)?.[1];
				return !id || !VALID_CODICONS.has(id);
			})
			.map((c) => `${c.command} → ${c.icon}`);
		expect(invalid, '无效或未登记的 codicon id').toEqual([]);
	});

	it('submenu 图标同样受校验（若声明了 icon）', () => {
		const invalid = (pkg.contributes.submenus ?? [])
			.filter((s): s is { id: string; icon: string } => typeof s.icon === 'string')
			.filter((s) => {
				const id = ICON_RE.exec(s.icon)?.[1];
				return !id || !VALID_CODICONS.has(id);
			})
			.map((s) => `${s.id} → ${s.icon}`);
		expect(invalid, '无效或未登记的 codicon id').toEqual([]);
	});
});
