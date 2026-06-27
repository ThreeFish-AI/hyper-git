import * as vscode from 'vscode';
import type { API, GitExtension } from '../types/git';

let cached: API | null | undefined;

/**
 * 获取内置 vscode.git 扩展导出的稳定 API（getAPI(1)）；不可用时返回 null。
 * 依赖声明：package.json `extensionDependencies: ["vscode.git"]`。
 */
export async function getGitApi(): Promise<API | null> {
	if (cached !== undefined) {
		return cached;
	}
	const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
	if (!ext) {
		cached = null;
		return null;
	}
	if (!ext.isActive) {
		await ext.activate();
	}
	if (!ext.exports?.enabled) {
		cached = null;
		return null;
	}
	cached = ext.exports.getAPI(1);
	return cached;
}

/** 重置缓存（测试用）。 */
export function resetGitApiCache(): void {
	cached = undefined;
}
