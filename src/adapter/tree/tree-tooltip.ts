import * as vscode from 'vscode';

/**
 * 树 Tooltip 共享构造器（MarkdownString，单一下沉入口）。
 *
 * 设计：可选标题行 + 一组 `**label:** value` 行；value 按是否含路径/分隔符自动 code-fence（提升 ref/路径可读性）。
 * 取代各树 `\n` 拼接的纯文本 tooltip，统一粗体标签 + code 样式，深/浅主题自适应。
 */
export function mdTooltip(rows: ReadonlyArray<readonly [string, string]>, opts?: { title?: string }): vscode.MarkdownString {
	const md = new vscode.MarkdownString('', true);
	md.isTrusted = false;
	md.supportThemeIcons = true;
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
	return md;
}

/** MarkdownString 转义：避免反引号/管道/反斜杠破坏 code-fence 或表格语义。 */
function escapeMd(s: string): string {
	return s.replace(/([\\`|])/g, '\\$1');
}

/**
 * ISO 时间 → 相对人可读描述（"just now" / "N min ago" / "N hr ago" / "N days ago" / "Mon D"）。
 * 用于 stash/shelf 行内描述；技术标识（stash@{n} / 原始 ISO）保留在 Tooltip。
 * 解析失败时原样返回，不阻断渲染。
 */
export function relativeDate(iso: string): string {
	const t = new Date(iso).getTime();
	if (Number.isNaN(t)) {
		return iso;
	}
	const diff = Date.now() - t;
	const min = 60_000;
	const hr = 3_600_000;
	const day = 86_400_000;
	if (diff < min) {
		return 'just now';
	}
	if (diff < hr) {
		return `${Math.floor(diff / min)} min ago`;
	}
	if (diff < day) {
		return `${Math.floor(diff / hr)} hr ago`;
	}
	const days = Math.floor(diff / day);
	if (days < 30) {
		return `${days} day${days === 1 ? '' : 's'} ago`;
	}
	return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
