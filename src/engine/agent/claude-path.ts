import * as path from 'path';

/**
 * Claude Code 相关路径的纯逻辑（零 vscode 依赖，Vitest 可测）。
 *
 * home 由调用方（adapter 层，`os.homedir()`）注入，保持函数确定性与跨平台正确性。
 */

/** Claude Code 用户设置文件（`~/.claude/settings.json`）的绝对路径。 */
export function defaultClaudeSettingsPath(home: string): string {
	return path.join(home, '.claude', 'settings.json');
}
