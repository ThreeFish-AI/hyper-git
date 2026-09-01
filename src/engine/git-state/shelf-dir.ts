import { createHash } from 'crypto';

/**
 * Shelf 仓库子目录命名（issue #107 按仓库隔离）。
 *
 * `basename(rootPath)` 截 48 字符保证可读，拼 `.` + sha1(rootPath) 前 8 位防
 * 同名仓库（如 `/a/api` 与 `/b/api`）碰撞。零 vscode 依赖，可单测。
 */

const SAFE = /[^a-zA-Z0-9_-]/g;

/** 仓库根路径 → shelf 存储子目录名（确定性：同 root 恒同值）。 */
export function shelfRepoDirName(repoRoot: string): string {
	const base = repoRoot.split(/[\\/]/).filter(Boolean).pop() ?? '';
	const safe = base.replace(SAFE, '_').slice(0, 48) || 'unnamed';
	const hash = createHash('sha1').update(repoRoot).digest('hex').slice(0, 8);
	return `${safe}.${hash}`;
}
