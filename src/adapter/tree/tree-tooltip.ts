import * as vscode from 'vscode';
import { formatRelative } from '../../engine/log/format-time';

/**
 * 树 Tooltip 共享构造器（MarkdownString，单一下沉入口）。
 *
 * 设计：可选标题行 + 一组 `**label:** value` 行；value 按是否含路径/分隔符自动 code-fence（提升 ref/路径可读性）。
 * 取代各树 `\n` 拼接的纯文本 tooltip，统一粗体标签 + code 样式，深/浅主题自适应。
 * 可选 `links` 追加可点击链接行（如「Open on GitHub」）——仅含链接行的实例放开 isTrusted，
 * href 由调用方先行主机白名单校验（反 SSRF），此处再做括号消毒防逃逸。
 *
 * 注入防线（行值可能承载远程可控文本，如 PR 标题）：值统一单行化并反斜杠转义 `[]()`；
 * code-fence 路径按值内最长反引号串加长 fence（code span 内反斜杠转义无效，必须按长度压制）；
 * isTrusted 采用 `{ enabledCommands: [] }` 白名单形态——http(s) 链接可点、command: 链接一律失效；
 * supportThemeIcons 恒关（无调用方在 tooltip 文本用 `$(icon)`，关闭可杜绝远程文本注入主题图标字形）。
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
	// supportThemeIcons 缺省 false（安全默认：无调用方用 `$(icon)`，且杜绝远程文本注入图标字形）。
	const md = new vscode.MarkdownString('');
	if (opts?.title) {
		md.appendMarkdown(`**${escapeMd(opts.title)}**\n\n`);
	}
	for (const [label, value] of rows) {
		if (!value) {
			continue;
		}
		const isPathLike = /[/.]/.test(value); // 路径或 ref → code 包裹
		md.appendMarkdown(`**${escapeMd(label)}:** ${isPathLike ? codeSpan(value) : escapeMd(value)}  \n`);
	}
	const links = opts?.links ?? [];
	if (links.length > 0) {
		// http 链接在树 Tooltip 可点击需 isTrusted；取 enabledCommands 空白名单形态——
		// http(s) 可点、command: 链接一律失效（行值含远程可控文本，防命令注入）。
		md.isTrusted = { enabledCommands: [] };
		for (const l of links) {
			md.appendMarkdown(`**${escapeMd(l.label)}:** [${escapeMd(l.text)}](${sanitizeHref(l.href)})  \n`);
		}
	}
	return md;
}

/** 行值单行化：换行折叠为空格（tooltip 行按单行呈现，也消除软换行后的语法注入面）。 */
function singleLine(s: string): string {
	return s.replace(/[\r\n]+/g, ' ');
}

/** MarkdownString 转义：单行化 + 反斜杠转义反引号/管道/反斜杠、`[]()`（防链接/图片语法注入）
 * 与 `<>`（防 CommonMark 角括号 autolink 在 isTrusted 实例中生成非白名单可点链接）。 */
function escapeMd(s: string): string {
	return singleLine(s).replace(/([\\`|[\]()<>])/g, '\\$1');
}

/** 任意值安全入 code span：fence 长于值内最长反引号串（code span 内反斜杠转义无效，须按长度压制）。 */
function codeSpan(value: string): string {
	const v = singleLine(value);
	const maxRun = v.match(/`+/g)?.reduce((m, r) => Math.max(m, r.length), 0) ?? 0;
	const fence = '`'.repeat(maxRun + 1);
	// 首尾为反引号时补空格垫层，避免 fence 与内容粘连（CommonMark 等长闭合扫描）。
	const pad = v.startsWith('`') || v.endsWith('`') ? ' ' : '';
	return fence + pad + v + pad + fence;
}

/** 链接 href 消毒：先对右括号百分号编码（纵深防御，防提前闭合 `[text](href)` 语法），再经 escapeMd 转义。 */
function sanitizeHref(href: string): string {
	return escapeMd(href.replace(/\)/g, '%29'));
}

/**
 * ISO 时间 → 相对人可读描述，委托 engine/log/format-time.formatRelative（单一事实源，
 * 措辞对齐官方 GRAPH）。用于 stash/shelf 行内描述；技术标识保留在 Tooltip。
 * 解析失败时原样返回（formatRelative 回空串），不阻断渲染。
 */
export function relativeDate(iso: string): string {
	return formatRelative(iso) || iso;
}
