import * as vscode from 'vscode';
import { NullChangelistGrouper } from './agent/grouper';
import { NullCommitMessageProvider } from './agent/commit-message';
import { NullConflictResolver } from './agent/conflict';
import { NullLlmProvider } from './agent/llm-provider';
import { NullPreCommitInspector } from './agent/pre-commit';
import { registerChangesCommands } from './adapter/commands';
import { ChangelistRegistry } from './adapter/changelist-registry';
import { BranchFavorites } from './adapter/branch-favorites';
import { CommitService } from './adapter/commit/commit-service';
import { BranchesTreeProvider } from './adapter/tree/branches-tree';
import { ChangesTreeProvider, EmptyChangesProvider } from './adapter/tree/changes-tree';
import { LogTreeProvider } from './adapter/tree/log-tree';
import { registerHistoryCommands } from './adapter/history-commands';
import { registerStashCommands } from './adapter/stash-commands';
import { registerGitCliCommands } from './adapter/git-cli-commands';
import { registerPartialCommands } from './adapter/partial-commands';
import { registerAdvancedCommands } from './adapter/advanced-commands';
import { registerRemoteCommands } from './adapter/remote-commands';
import { StashTreeProvider } from './adapter/tree/stash-tree';
import { WorktreeTreeProvider } from './adapter/tree/worktree-tree';
import { registerWorktreeCommands } from './adapter/worktree-commands';
import { CommitWebviewProvider } from './adapter/webview/commit-webview';
import { GraphWebview } from './adapter/webview/graph-webview';
import { showGitConsole } from './infra/git-console';
import { InlineCommitCodeLensProvider, registerInlineCommitCommand } from './adapter/editor/inline-commit-codelens';
import { BlameAnnotationController } from './adapter/editor/blame-annotation';
import { ShelfService, ShelfTreeProvider, registerShelfCommands } from './adapter/shelf';
import { RebaseWebview } from './adapter/webview/rebase-webview';
import { registerMergeCommands } from './adapter/webview/merge-editor';
import { registerMiscCommands } from './adapter/misc-commands';
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
		const empty = new EmptyChangesProvider();
		context.subscriptions.push(
			vscode.window.registerTreeDataProvider('hyperGit.changes', empty),
			vscode.window.registerTreeDataProvider('hyperGit.worktrees', empty),
		);
		return;
	}

	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? 'default';
	const service = new GitRepositoryService(api);
	const registry = new ChangelistRegistry(context.workspaceState, service.repoRoot ?? workspaceRoot);
	const favorites = new BranchFavorites(context.workspaceState, service.repoRoot ?? workspaceRoot);
	const tree = new ChangesTreeProvider(service, registry);
	// createTreeView（registerTreeDataProvider 的超集）以获取 TreeView 句柄承载 .badge；
	// 活动栏容器图标的数字角标 = 容器内各视图 badge.value 之和，故此处点亮即映射到 Hyper Git 图标。
	const changesView = vscode.window.createTreeView('hyperGit.changes', { treeDataProvider: tree });

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
	const branchesTree = new BranchesTreeProvider(service, favorites);
	// Branches 视图启用多选（canSelectMany 仅 createTreeView 支持，registerTreeDataProvider 不支持）；
	// 多选后批量操作（删除分支/标签、复制引用、收藏）作用于整个选区。
	const branchesView = vscode.window.createTreeView('hyperGit.branches', {
		treeDataProvider: branchesTree,
		canSelectMany: true,
	});
	const stashTree = new StashTreeProvider(service);
	const worktreeTree = new WorktreeTreeProvider(service);
	const inlineLens = new InlineCommitCodeLensProvider(service);
	const blame = new BlameAnnotationController(service);
	const shelfService = new ShelfService(service, context.globalStorageUri.fsPath);
	const shelfTree = new ShelfTreeProvider(shelfService);
	const focusCommitView = (): void => {
		void vscode.commands.executeCommand('hyperGit.commit.focus');
	};

	context.subscriptions.push(
		service,
		registry,
		favorites,
		commit,
		logTree,
		branchesTree,
		stashTree,
		worktreeTree,
		shelfTree,
		blame,
		changesView,
		branchesView,
		vscode.window.registerWebviewViewProvider(CommitWebviewProvider.viewType, commitView),
		vscode.window.registerTreeDataProvider('hyperGit.log', logTree),
		vscode.window.registerTreeDataProvider('hyperGit.stash', stashTree),
		vscode.window.registerTreeDataProvider('hyperGit.shelf', shelfTree),
		vscode.window.registerTreeDataProvider('hyperGit.worktrees', worktreeTree),
		...registerChangesCommands(service, registry, tree),
		...registerHistoryCommands(service, logTree, branchesTree, favorites),
		...registerGitCliCommands(service, branchesTree, logTree),
		...registerPartialCommands(service, registry),
		...registerAdvancedCommands(service, branchesTree),
		...registerRemoteCommands(service, branchesTree, logTree),
		...registerMergeCommands(service),
		...registerMiscCommands(service, branchesTree, logTree),
		vscode.commands.registerCommand('hyperGit.toggleBlameAnnotation', () => blame.toggle()),
		...registerStashCommands(service, stashTree),
		...registerShelfCommands(service, shelfService, shelfTree),
		...registerWorktreeCommands(service, worktreeTree),
		vscode.commands.registerCommand('hyperGit.commit', focusCommitView),
		vscode.commands.registerCommand('hyperGit.commitAndPush', focusCommitView),
		vscode.commands.registerCommand('hyperGit.showGraph', () => GraphWebview.open(service)),
		vscode.commands.registerCommand('hyperGit.showConsole', () => showGitConsole()),
		vscode.commands.registerCommand('hyperGit.startRebase', () => RebaseWebview.open(service)),
		vscode.languages.registerCodeLensProvider({ scheme: 'file' }, inlineLens),
		registerInlineCommitCommand(service, inlineLens),
	);

	// 活动栏角标：复用 service.getChanges() 计数（index+工作区+未跟踪去重），与 Changes 视图内容一致；
	// 计数为 0 时清空，对齐原生 SCM 行为。
	const updateChangesBadge = (): void => {
		const count = service.getChanges().length;
		changesView.badge = count > 0 ? { value: count, tooltip: `${count} 个未提交变更` } : undefined;
	};

	// git 状态变化频繁（add/checkout/diff 缓存失效均触发），防抖合并避免 log/stash 高频重拉。
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;
	const refreshAll = (): void => {
		clearTimeout(refreshTimer);
		refreshTimer = setTimeout(() => {
			tree.refresh();
			updateChangesBadge();
			commitView.refresh();
			logTree.refresh();
			branchesTree.refresh();
			stashTree.refresh();
			worktreeTree.refresh();
			shelfTree.refresh();
			inlineLens.refresh();
		}, 150);
	};
	context.subscriptions.push(
		service.onDidChange(refreshAll),
		registry.onDidChange(refreshAll),
		commit.onDidChange(refreshAll),
	);

	// 首帧保险：若 repo 在 activate 前已就绪，GitRepositoryService 构造函数的 _onDidChange.fire()
	// 早于任何订阅者挂载而被丢失，state.onDidChange 此后可能不再触发。主动刷新一次确保
	// Branches/Log 不停留在首帧空状态（getChildren 内已对未就绪数据做 CLI 兜底与空安全处理）。
	setTimeout(() => {
		branchesTree.refresh();
		logTree.refresh();
		worktreeTree.refresh();
		updateChangesBadge();
	}, 500);
}

export function deactivate(): void {
	// 预留：M3+ 在此释放长生命周期资源。
}
