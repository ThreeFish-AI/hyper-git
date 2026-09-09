import * as vscode from 'vscode';

export interface Logger extends vscode.Disposable {
	info(message: string): void;
	warn(message: string): void;
	error(message: string, err?: unknown): void;
	show(): void;
}

/**
 * 创建基于 LogOutputChannel 的日志器（1.74+：自动时间戳与级别、统一日志视图可过滤，
 * 取代手写 [info]/[warn] 前缀）。懒创建：首次写入才建 channel，未产生日志的会话零开销。
 */
export function createLogger(name = 'Hyper Git'): Logger {
	let channel: vscode.LogOutputChannel | undefined;
	const getChannel = (): vscode.LogOutputChannel =>
		(channel ??= vscode.window.createOutputChannel(name, { log: true }));
	return {
		info: (message) => getChannel().info(message),
		warn: (message) => getChannel().warn(message),
		error: (message, err) => {
			if (err === undefined) {
				getChannel().error(message);
			} else {
				getChannel().error(message, err instanceof Error ? err.message : err);
			}
		},
		show: () => getChannel().show(true),
		dispose: () => channel?.dispose(),
	};
}
