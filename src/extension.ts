import * as vscode from 'vscode';
import { createLogger } from './infra/logger';
import { NullLlmProvider } from './agent/llm-provider';

/**
 * 扩展入口。仅做装配（DI 注册），业务逻辑下沉到 engine/adapter 层。
 */
export function activate(context: vscode.ExtensionContext): void {
	const logger = createLogger();
	logger.info('Hyper Git activated');

	// AI 接缝注入（Null 实现，M5 替换为真实 ILlmProvider）。
	const llm = new NullLlmProvider();

	const showVersion = vscode.commands.registerCommand('hyperGit.showVersion', () => {
		const version: string = context.extension.packageJSON.version;
		vscode.window.showInformationMessage(`Hyper Git v${version}`);
		logger.info(`showVersion: version=${version}, llmSource=${llm.sourceId}`);
	});

	// Changes 视图占位（M1 接入真实 changelist registry + vscode.git workingTreeChanges）。
	const changesProvider = new PlaceholderChangesProvider();
	const changesView = vscode.window.registerTreeDataProvider('hyperGit.changes', changesProvider);

	context.subscriptions.push(showVersion, changesView);
}

export function deactivate(): void {
	// 预留：M1+ 在此释放长生命周期资源。
}

/** M0 占位：空树 → 触发 viewsWelcome 内容显示。M1 替换为真实 changelist TreeDataProvider。 */
class PlaceholderChangesProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(): vscode.TreeItem[] {
		return [];
	}
}
