import * as vscode from 'vscode';

export interface Logger {
	info(message: string): void;
	warn(message: string): void;
	error(message: string, err?: unknown): void;
	show(): void;
}

/** 创建基于 OutputChannel 的日志器。 */
export function createLogger(name = 'Hyper Git'): Logger {
	const channel = vscode.window.createOutputChannel(name);
	return {
		info: (message) => channel.appendLine(`[info] ${message}`),
		warn: (message) => channel.appendLine(`[warn] ${message}`),
		error: (message, err) => channel.appendLine(`[error] ${message}${err !== undefined ? `: ${String(err)}` : ''}`),
		show: () => channel.show(),
	};
}
