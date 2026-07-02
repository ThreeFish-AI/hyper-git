import { describe, it, expect } from 'vitest';
import { getBaseStyles, getButtonClass } from '../../src/adapter/webview/shared-styles';

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
		expect(css).toContain('.hg-row');
	});

	it('getBaseStyles 统一交互态：hover / focus-visible / disabled / reduced-motion', () => {
		const css = getBaseStyles();
		expect(css).toContain(':hover');
		expect(css).toContain(':focus-visible');
		expect(css).toContain(':disabled');
		expect(css).toContain('prefers-reduced-motion');
	});

	it('getBaseStyles 颜色一律走 --vscode-* 语义令牌（不硬编码裸 hex 作主色）', () => {
		const css = getBaseStyles();
		expect(css).toContain('var(--vscode-button-background)');
		expect(css).toContain('var(--vscode-focusBorder)');
		expect(css).toContain('var(--vscode-list-hoverBackground)');
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
