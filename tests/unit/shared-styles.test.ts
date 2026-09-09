import { describe, it, expect } from 'vitest';
import { getBaseStyles, getButtonClass, GRAPH_ROW_H, GRAPH_LANE_W } from '../../src/adapter/webview/shared-styles';

describe('shared-styles', () => {
	it('getBaseStyles 暴露 spacing/radius token 与全部基础组件类', () => {
		const css = getBaseStyles();
		// 设计 Token（4/8 节奏 + 圆角）
		expect(css).toContain('--hg-space-1: 4px');
		expect(css).toContain('--hg-space-2: 8px');
		expect(css).toContain('--hg-radius-control');
		// 基础组件类（单一事实源）
		expect(css).toContain('.hg-btn');
		expect(css).toContain('.hg-btn--secondary');
		expect(css).toContain('.hg-btn--sm');
		expect(css).toContain('.hg-input');
		expect(css).toContain('.hg-select');
	});

	it('GRAPH 行高/列宽常量与 CSS 变量同源注入（消除 CSS/JS 双源漂移）', () => {
		const css = getBaseStyles();
		expect(css).toContain(`--hg-row: ${GRAPH_ROW_H}px`);
		expect(css).toContain(`--hg-lane: ${GRAPH_LANE_W}px`);
		expect(GRAPH_ROW_H).toBeGreaterThan(0);
		expect(GRAPH_LANE_W).toBeGreaterThan(0);
	});

	it('getBaseStyles 统一交互态：hover / focus-visible / disabled / reduced-motion / forced-colors', () => {
		const css = getBaseStyles();
		expect(css).toContain(':hover');
		expect(css).toContain(':focus-visible');
		expect(css).toContain(':disabled');
		expect(css).toContain('prefers-reduced-motion');
		expect(css).toContain('forced-colors');
	});

	it('全局控件基线：滚动条与 checkbox 走主题令牌', () => {
		const css = getBaseStyles();
		expect(css).toContain('::-webkit-scrollbar');
		expect(css).toContain('--vscode-scrollbarSlider-background');
		expect(css).toContain('accent-color');
		expect(css).toContain('--vscode-checkbox-background');
	});

	it('getBaseStyles 颜色一律走 --vscode-* 语义令牌（不硬编码裸 hex 作主色）', () => {
		const css = getBaseStyles();
		expect(css).toContain('var(--vscode-button-background)');
		expect(css).toContain('var(--vscode-focusBorder)');
		expect(css).toContain('var(--vscode-input-background)');
		expect(css).toContain('var(--vscode-dropdown-background)');
	});

	it('字号以 --vscode-font-size 为基准（随用户字号设置缩放，无裸 px 主字号）', () => {
		const css = getBaseStyles();
		expect(css).toContain('font-size: var(--vscode-font-size)');
		expect(css).toContain('calc(var(--vscode-font-size) - 2px)');
		expect(css).not.toMatch(/font-size: 1[0-9]px/);
	});

	it('getButtonClass 按变体拼出正确的 class 串', () => {
		expect(getButtonClass()).toBe('hg-btn');
		expect(getButtonClass('primary')).toBe('hg-btn');
		expect(getButtonClass('secondary')).toBe('hg-btn hg-btn--secondary');
		expect(getButtonClass('sm')).toBe('hg-btn hg-btn--sm');
	});

	it('getBaseStyles 是纯函数（多次调用返回一致内容）', () => {
		expect(getBaseStyles()).toBe(getBaseStyles());
	});
});
