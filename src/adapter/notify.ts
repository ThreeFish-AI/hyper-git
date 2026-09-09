import * as vscode from 'vscode';
import { showGitConsole } from '../infra/git-console';

/**
 * git 操作失败通知 + "Show Output" 动作按钮（联动 Hyper Git Console 命令誊录通道）。
 * 与裸 showErrorMessage 的差别：给用户一条直达诊断信息的路径（含 execGit 透传的 stderr）。
 */
export async function showGitError(message: string): Promise<void> {
	const choice = await vscode.window.showErrorMessage(message, 'Show Output');
	if (choice === 'Show Output') {
		showGitConsole();
	}
}
