import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { defaultClaudeSettingsPath } from '../../src/engine/agent/claude-path';

describe('claude-path', () => {
	it('拼接 <home>/.claude/settings.json', () => {
		const home = path.join(path.sep, 'Users', 'x');
		expect(defaultClaudeSettingsPath(home)).toBe(path.join(home, '.claude', 'settings.json'));
	});

	it('以 .claude/settings.json 结尾（跨平台分隔符）', () => {
		const result = defaultClaudeSettingsPath(path.join(path.sep, 'home', 'dev'));
		expect(result.endsWith(path.join('.claude', 'settings.json'))).toBe(true);
	});

	it('绝对路径以 home 为前缀', () => {
		const home = path.join(path.sep, 'root');
		expect(defaultClaudeSettingsPath(home).startsWith(home)).toBe(true);
	});
});
