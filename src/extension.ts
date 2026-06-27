import * as vscode from 'vscode';
import { NullChangelistGrouper } from './agent/grouper';
import { NullCommitMessageProvider } from './agent/commit-message';
import { NullConflictResolver } from './agent/conflict';
import { NullLlmProvider } from './agent/llm-provider';
import { NullPreCommitInspector } from './agent/pre-commit';
import { registerChangesCommands } from './adapter/commands';
import { ChangelistRegistry } from './adapter/changelist-registry';
import { CommitService } from './adapter/commit/commit-service';
import { BranchesTreeProvider } from './adapter/tree/branches-tree';
import { ChangesTreeProvider, EmptyChangesProvider } from './adapter/tree/changes-tree';
import { LogTreeProvider } from './adapter/tree/log-tree';
import { registerHistoryCommands } from './adapter/history-commands';
import { registerStashCommands } from './adapter/stash-commands';
import { registerGitCliCommands } from './adapter/git-cli-commands';
import { registerPartialCommands } from './adapter/partial-commands';
import { registerAdvancedCommands } from './adapter/advanced-commands';
import { StashTreeProvider } from './adapter/tree/stash-tree';
import { CommitWebviewProvider } from './adapter/webview/commit-webview';
import { GraphWebview } from './adapter/webview/graph-webview';
import { showGitConsole } from './infra/git-console';
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

	const api = await getGitApi();
	if (!api) {
		logger.warn('vscode.git API 不可用，视图保持空状态');
		context.subscriptions.push(vscode.window.registerTreeDataProvider('hyperGit.changes', new EmptyChangesProvider()));
		return;
	}

	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? 'default';
	const service = new GitRepositoryService(api);
	const registry = new ChangelistRegistry(context.workspaceState, service.repoRoot ?? workspaceRoot);
	const tree = new ChangesTreeProvider(service, registry);

	// AI 接缝注入（Null 实现，M5 替换为真实 provider）
	const commit = new CommitService(context, service, context.workspaceState, {
		llm,
		commitMessage: new NullCommitMessageProvider(),
		preCommit: new NullPreCommitInspector(),
		grouper: new NullChangelistGrouper(),
		conflict: new NullConflictResolver(),
	});
	const commitView = new CommitWebviewProvider(service, registry, commit);
	const logTree = new LogTreeProvider(service);
	const branchesTree = new BranchesTreeProvider(service);
	const stashTree = new StashTreeProvider(service);
	const focusCommitView = (): void => {
		void vscode.commands.executeCommand('hyperGit.commit.focus');
	};

	context.subscriptions.push(
		service,
		registry,
		commit,
		logTree,
		branchesTree,
		stashTree,
		vscode.window.registerTreeDataProvider('hyperGit.changes', tree),
		vscode.window.registerWebviewViewProvider(CommitWebviewProvider.viewType, commitView),
		vscode.window.registerTreeDataProvider('hyperGit.log', logTree),
		vscode.window.registerTreeDataProvider('hyperGit.branches', branchesTree),
		vscode.window.registerTreeDataProvider('hyperGit.stash', stashTree),
		...registerChangesCommands(service, registry, tree),
		...registerHistoryCommands(service, logTree, branchesTree),
		...registerGitCliCommands(service, branchesTree),
		...registerPartialCommands(service),
		...registerAdvancedCommands(service, branchesTree),
		...registerStashCommands(service, stashTree),
		vscode.commands.registerCommand('hyperGit.commit', focusCommitView),
		vscode.commands.registerCommand('hyperGit.commitAndPush', focusCommitView),
		vscode.commands.registerCommand('hyperGit.showGraph', () => GraphWebview.open(service)),
		vscode.commands.registerCommand('hyperGit.showConsole', () => showGitConsole()),
	);

	// git 状态变化频繁（add/checkout/diff 缓存失效均触发），防抖合并避免 log/stash 高频重拉。
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;
	const refreshAll = (): void => {
		clearTimeout(refreshTimer);
		refreshTimer = setTimeout(() => {
			tree.refresh();
			commitView.refresh();
			logTree.refresh();
			branchesTree.refresh();
			stashTree.refresh();
		}, 150);
	};
	context.subscriptions.push(
		service.onDidChange(refreshAll),
		registry.onDidChange(refreshAll),
		commit.onDidChange(refreshAll),
	);
}

export function deactivate(): void {
	// 预留：M3+ 在此释放长生命周期资源。
}
