import * as vscode from 'vscode';
import { formatRelative } from '../../engine/log/format-time';

/**
 * 树 Tooltip 共享构造器（MarkdownString，单一下沉入口）。
 *
 * 设计：可选标题行 + 一组 `**label:** value` 行；value 按是否含路径/分隔符自动 code-fence（提升 ref/路径可读性）。
 * 取代各树 `\n` 拼接的纯文本 tooltip，统一粗体标签 + code 样式，深/浅主题自适应。
 * 可选 `links` 追加可点击链接行（如「Open on GitHub」）——仅含链接行的实例放开 isTrusted，
 * href 由调用方先行主机白名单校验（反 SSRF），此处再做括号消毒防链接语法注入。
 */

/** 可点击链接行（label 粗体前缀 + 链接文本 + href）。 */
export interface TooltipLink {
	readonly label: string;
	readonly text: string;
	readonly href: string;
}

export function mdTooltip(
	rows: ReadonlyArray<readonly [string, string]>,
	opts?: { title?: string; links?: readonly TooltipLink[] },
): vscode.MarkdownString {
	// 构造器第二参即 supportThemeIcons（无冗余属性赋值）；isTrusted 缺省 false（安全默认）。
	const md = new vscode.MarkdownString('', true);
	if (opts?.title) {
		md.appendMarkdown(`**${escapeMd(opts.title)}**\n\n`);
	}
	for (const [label, value] of rows) {
		if (!value) {
			continue;
		}
		const isPathLike = /[/.]/.test(value); // 路径或 ref → code 包裹
		md.appendMarkdown(`**${escapeMd(label)}:** ${isPathLike ? '`' + escapeMd(value) + '`' : escapeMd(value)}  \n`);
	}
	const links = opts?.links ?? [];
	if (links.length > 0) {
		// http 链接在树 Tooltip 可点击需 isTrusted；href 已过调用方白名单，此处消毒括号防逃逸。
		md.isTrusted = true;
		for (const l of links) {
			md.appendMarkdown(`**${escapeMd(l.label)}:** [${escapeMd(l.text)}](${sanitizeHref(l.href)})  \n`);
		}
	}
	return md;
}

/** MarkdownString 转义：避免反引号/管道/反斜杠破坏 code-fence 或表格语义。 */
function escapeMd(s: string): string {
	return s.replace(/([\\`|])/g, '\\$1');
}

/** 链接 href 消毒：转义反斜杠/反引号，右括号百分号编码（防提前闭合 `[text](href)` 语法）。 */
function sanitizeHref(href: string): string {
	return escapeMd(href).replace(/\)/g, '%29');
}

/**
 * ISO 时间 → 相对人可读描述，委托 engine/log/format-time.formatRelative（单一事实源，
 * 措辞对齐官方 GRAPH）。用于 stash/shelf 行内描述；技术标识保留在 Tooltip。
 * 解析失败时原样返回（formatRelative 回空串），不阻断渲染。
 */
export function relativeDate(iso: string): string {
	return formatRelative(iso) || iso;
}
