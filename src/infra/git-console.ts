import * as vscode from 'vscode';

/**
 * Hyper Git Console：对齐 IDEA Console 标签页，记录所有经 execGit 执行的 git 命令及其输出。
 * 复用单一 OutputChannel（懒构造）。
 */
let channel: vscode.OutputChannel | undefined;

function getChannel(): vscode.OutputChannel {
	if (!channel) {
		channel = vscode.window.createOutputChannel('Hyper Git Console');
	}
	return channel;
}

/** 记录一条 git 命令（及其输出/错误）到 Console。 */
export function logGit(args: readonly string[], output?: string, error?: string): void {
	const c = getChannel();
	c.appendLine(`$ git ${args.join(' ')}`);
	if (output) {
		c.appendLine(output);
	}
	if (error) {
		c.appendLine(`[error] ${error}`);
	}
}

/** 显示 Console 面板。 */
export function showGitConsole(): void {
	getChannel().show(true);
}
