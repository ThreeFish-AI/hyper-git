/**
 * Webview 共享设计 Token 与基础组件类（单一事实源）。
 *
 * 4 个自绘 Webview（Commit / Log / Merge / Rebase）共享同一套：
 * - 设计 Token（spacing/radius，对齐 VS Code 语义）；
 * - 基础组件类（`.hg-btn` / `.hg-btn--secondary` / `.hg-btn--sm` / `.hg-input` / `.hg-row`）
 *   统一交互态（hover / active / focus-visible / disabled），消除各 Webview 各自硬编码导致的
 *   「按钮无 hover」「`:last-child` 脆弱选择器」「无 focus ring」等熵增。
 *
 * 设计原则：纯字符串、零 vscode 依赖（可单测）；每个 Webview 在 `<style>` 首行注入
 * {@link getBaseStyles}，再追加本地视图专属规则。本地规则可在必要时覆盖 token 派生值。
 *
 * 主题策略：颜色一律走 `--vscode-*` 语义令牌（深/浅主题自适应），不硬编码 hex。
 */

/** 按钮视觉变体。 */
export type ButtonVariant = 'primary' | 'secondary' | 'sm';

/**
 * 基础样式：`:root` Token + 通用组件类 + 统一交互态。
 * 返回纯 CSS 字符串，供 Webview 在 `<style>` 首行注入。
 */
export function getBaseStyles(): string {
	return `:root {
	--hg-space-1: 4px;
	--hg-space-2: 8px;
	--hg-space-3: 12px;
	--hg-space-4: 16px;
	--hg-space-6: 24px;
	--hg-radius-control: var(--vscode-button-borderRadius, 3px);
	--hg-radius-panel: 4px;
}
.hg-btn {
	padding: 6px 10px;
	border: none;
	border-radius: var(--hg-radius-control);
	cursor: pointer;
	background: var(--vscode-button-background);
	color: var(--vscode-button-foreground);
	font-size: 13px;
	font-family: var(--vscode-font-family);
	transition: background-color .12s ease, filter .12s ease, opacity .12s ease;
}
.hg-btn:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
.hg-btn:active { filter: brightness(0.92); }
.hg-btn:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }
.hg-btn:disabled { opacity: 0.5; cursor: default; }
.hg-btn--secondary {
	background: var(--vscode-button-secondaryBackground);
	color: var(--vscode-button-secondaryForeground);
	border: 1px solid var(--vscode-button-border, transparent);
}
.hg-btn--secondary:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground)); }
.hg-btn--sm { padding: 2px 8px; font-size: 11px; }
.hg-input {
	background: var(--vscode-input-background);
	color: var(--vscode-input-foreground);
	border: 1px solid var(--vscode-input-border, transparent);
	border-radius: var(--hg-radius-control);
	padding: 6px;
	font-family: var(--vscode-editor-font-family);
	font-size: var(--vscode-font-size);
}
.hg-input:focus { border-color: var(--vscode-inputOption-activeBorder, var(--vscode-focusBorder)); }
.hg-input:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: -1px; }
.hg-row { display: flex; align-items: center; gap: 6px; padding: 2px 8px; cursor: pointer; }
.hg-row:hover { background: var(--vscode-list-hoverBackground); }
@media (prefers-reduced-motion: reduce) {
	.hg-btn { transition: none; }
}`;
}

/**
 * 便捷拼接按钮 class（用于 TS 模板字符串动态构造按钮）。
 * `getButtonClass()` → 主按钮；`getButtonClass('secondary')` → 次按钮；`getButtonClass('sm')` → 小按钮。
 */
export function getButtonClass(variant?: ButtonVariant): string {
	if (variant === 'secondary') {
		return 'hg-btn hg-btn--secondary';
	}
	if (variant === 'sm') {
		return 'hg-btn hg-btn--sm';
	}
	return 'hg-btn';
}
