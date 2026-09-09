import * as vscode from 'vscode';

/**
 * 长时 git 操作的进度反馈封装（对齐全内置 Git 视图行为）。
 *
 * 默认 ProgressLocation.Window（标题栏非阻塞、不遮挡交互）；重量级或可能长时间
 * 无响应的操作（updateProject、交互 rebase）以 Notification 位置显式告知。
 * cancellable 恒 false：execGit 无 kill 通道，真取消需先打通进程终止，延后实现。
 * 只应包裹用户交互（QuickPick/确认框）完成后的 git 执行段，避免进度条覆盖对话框。
 */
export async function runWithProgress<T>(
	title: string,
	task: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>,
	opts?: { location?: vscode.ProgressLocation },
): Promise<T> {
	return vscode.window.withProgress({ location: opts?.location ?? vscode.ProgressLocation.Window, title, cancellable: false }, task);
}
