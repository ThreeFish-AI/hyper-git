import * as vscode from 'vscode';
import { NullLlmProvider } from './agent/llm-provider';
import { registerChangesCommands } from './adapter/commands';
import { ChangelistRegistry } from './adapter/changelist-registry';
import { ChangesTreeProvider, EmptyChangesProvider } from './adapter/tree/changes-tree';
import { getGitApi } from './adapter/git-api';
import { GitRepositoryService } from './adapter/git-repository-service';
import { createLogger } from './infra/logger';

/**
 * 扩展入口。仅做装配（DI 注册），业务逻辑下沉到 engine/adapter 层。
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const logger = createLogger();
	logger.info('Hyper Git activated');

	const llm = new NullLlmProvider();

	context.subscriptions.push(
		vscode.commands.registerCommand('hyperGit.showVersion', () => {
			const version: string = context.extension.packageJSON.version;
			vscode.window.showInformationMessage(`Hyper Git v${version}`);
			logger.info(`version=${version}, llmSource=${llm.sourceId}`);
		}),
	);

	// M1：Git Adapter + Changes TreeView（多 changelist）
	const api = await getGitApi();
	if (!api) {
		logger.warn('vscode.git API 不可用，Changes 视图保持空状态');
		context.subscriptions.push(vscode.window.registerTreeDataProvider('hyperGit.changes', new EmptyChangesProvider()));
		return;
	}

	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? 'default';
	const service = new GitRepositoryService(api);
	const registry = new ChangelistRegistry(context.workspaceState, service.repoRoot ?? workspaceRoot);
	const tree = new ChangesTreeProvider(service, registry);

	context.subscriptions.push(
		service,
		registry,
		vscode.window.registerTreeDataProvider('hyperGit.changes', tree),
		...registerChangesCommands(service, registry, tree),
	);
	service.onDidChange(() => tree.refresh());
	registry.onDidChange(() => tree.refresh());
}

export function deactivate(): void {
	// 预留：M2+ 在此释放长生命周期资源。
}
