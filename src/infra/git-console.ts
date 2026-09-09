import * as vscode from 'vscode';

/**
 * Hyper Git Console：记录所有经 execGit 执行的 git 命令及其输出。
 * 复用单一 LogOutputChannel（懒构造；{log:true} 使其纳入统一日志视图，appendLine
 * 保持 `$ git …` 誊录形态不加分级别前缀，命令回显可读性优先）。
 */
let channel: vscode.LogOutputChannel | undefined;

function getChannel(): vscode.LogOutputChannel {
	if (!channel) {
		channel = vscode.window.createOutputChannel('Hyper Git Console', { log: true });
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

/** 释放 channel（随扩展 deactivate；extension.ts 订阅调用）。 */
export function disposeGitConsole(): void {
	channel?.dispose();
	channel = undefined;
}
