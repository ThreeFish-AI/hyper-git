/**
 * 提交时间格式化（纯逻辑，零 vscode 依赖）。
 *
 * 供 Commit 详情面板在 host 侧预格式化「相对时间（2 days ago）+ 绝对时间（本地化）」，
 * 以字符串下发给 webview 显示（webview 内联 JS 无法 import TS，故格式化收敛到 host 单点、可单测）。
 * `now` 参数显式注入（默认 `Date.now()`），使相对时间可确定性测试。
 */

const MIN = 60_000;
const HR = 3_600_000;
const DAY = 86_400_000;

/** ISO 时间 → 相对描述（just now / N min ago / N hr ago / N day(s) ago / 超 30 天回落本地日期）。 */
export function formatRelative(iso: string, now: number = Date.now()): string {
	const t = new Date(iso).getTime();
	if (isNaN(t)) {
		return '';
	}
	const diff = now - t;
	if (diff < MIN) {
		return 'just now';
	}
	if (diff < HR) {
		return `${Math.floor(diff / MIN)} min ago`;
	}
	if (diff < DAY) {
		return `${Math.floor(diff / HR)} hr ago`;
	}
	const days = Math.floor(diff / DAY);
	if (days < 30) {
		return `${days} ${days === 1 ? 'day' : 'days'} ago`;
	}
	return new Date(t).toLocaleDateString();
}

/** ISO 时间 → 本地化绝对时间字符串；非法时间回空串。 */
export function formatAbsolute(iso: string): string {
	const d = new Date(iso);
	if (isNaN(d.getTime())) {
		return '';
	}
	return d.toLocaleString();
}
