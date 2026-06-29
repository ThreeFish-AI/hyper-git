import { describe, it, expect } from 'vitest';
import { ALLOWED_COMMIT_TYPES, validateConventional } from '../../src/engine/commit/conventional-linter';

describe('validateConventional', () => {
	it('空信息 → error', () => {
		expect(validateConventional('').severity).toBe('error');
		expect(validateConventional('   ').severity).toBe('error');
	});

	it('规范 type(scope): desc → ok', () => {
		expect(validateConventional('feat(auth): 添加登录').severity).toBe('ok');
		expect(validateConventional('fix: 修复崩溃').severity).toBe('ok');
		expect(validateConventional('chore!: 破坏性变更').severity).toBe('ok');
		expect(validateConventional('refactor(parser): 重构').severity).toBe('ok');
	});

	it('缺冒号后空格 → error', () => {
		expect(validateConventional('feat:无空格').severity).toBe('error');
	});

	it('缺冒号 → error', () => {
		expect(validateConventional('feat无冒号').severity).toBe('error');
	});

	it('未知 type → error', () => {
		expect(validateConventional('unknown: 描述').severity).toBe('error');
	});

	it('主题过长 → warning（仍可提交）', () => {
		const long = 'feat: ' + 'a'.repeat(80);
		const v = validateConventional(long);
		expect(v.severity).toBe('warning');
	});

	it('多行信息以首行判定', () => {
		expect(validateConventional('feat: 主题\n\n正文描述').severity).toBe('ok');
	});

	it('reason 在非 ok 时提供', () => {
		const v = validateConventional('bad');
		expect(v.severity).toBe('error');
		expect(v.reason).toBeTruthy();
	});

	it('暴露允许的 type 集合', () => {
		expect(ALLOWED_COMMIT_TYPES).toContain('feat');
		expect(ALLOWED_COMMIT_TYPES).toContain('refactor');
		expect(ALLOWED_COMMIT_TYPES).toContain('revert');
	});
});
