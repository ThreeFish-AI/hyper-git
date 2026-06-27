import { defineConfig } from 'vitest/config';

// 仅用于 engine/ 纯逻辑（零 vscode 依赖）；adapter/ 集成测试走 @vscode/test-electron。
export default defineConfig({
	test: {
		include: ['tests/unit/**/*.test.ts'],
		environment: 'node',
		reporters: ['default'],
	},
});
