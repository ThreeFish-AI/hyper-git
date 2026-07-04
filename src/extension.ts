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
import { LogWebviewProvider } from './adapter/webview/log-webview';
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
import { showGitConsole } from './infra/git-console';
import { InlineCommitCodeLensProvider, registerInlineCommitCommand } from './adapter/editor/inline-commit-codelens';
import { BlameAnnotationController } from './adapter/editor/blame-annotation';
import { ShelfService, ShelfTreeProvider, registerShelfCommands } from './adapter/shelf';
import { RebaseWebview } from './adapter/webview/rebase-webview';
import { registerMergeCommands } from './adapter/webview/merge-editor';
import { registerMiscCommands } from './adapter/misc-commands';
import { getGitApi } from './adapter/git-api';
import { GitRepositoryService } from './adapter/git-repository-service';
import { GitHubAuth } from './adapter/ci/github-auth';
import { GitHubCiService } from './adapter/ci/github-ci-service';
import { createLogger } from './infra/logger';

/** 无 git 时的占位树 provider（空树，触发 viewsWelcome）。原 EmptyChangesProvider 随 Changes 视图移除后内联于此。 */
class EmptyTreeProvider implements vscode.TreeDataProvider<never> {
	getTreeItem(): vscode.TreeItem {
		return new vscode.TreeItem('');
	}
	getChildren(): never[] {
		return [];
	}
}

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
		const empty = new EmptyTreeProvider();
		context.subscriptions.push(
			vscode.window.registerTreeDataProvider('hyperGit.worktrees', empty),
		);
		return;
	}

	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? 'default';
	const service = new GitRepositoryService(api);
	const registry = new ChangelistRegistry(context.workspaceState, service.repoRoot ?? workspaceRoot);
	const favorites = new BranchFavorites(context.workspaceState, service.repoRoot ?? workspaceRoot);
	const githubAuth = new GitHubAuth(context.subscriptions);
	const ciService = new GitHubCiService(service, githubAuth, logger);

	// AI 接缝注入（Null 实现，M5 替换为真实 provider）
	const commit = new CommitService(context, service, context.workspaceState, {
		llm,
		commitMessage: new NullCommitMessageProvider(),
		preCommit: new NullPreCommitInspector(),
		grouper: new NullChangelistGrouper(),
		conflict: new NullConflictResolver(),
	});
	const commitView = new CommitWebviewProvider(service, registry, commit);
	const logTree = new LogWebviewProvider(service, ciService);
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
	// 活动栏未提交数角标承载：隐藏 TreeView（package.json 中 when:false，永不渲染）。createTreeView 于
	// activate 即实例化视图对象，其 badge 无论面板是否打开都可靠聚合到容器图标——规避 WebviewView.badge
	// 在 resolveWebviewView（用户至少打开过一次视图）前无法显示的已知限制（microsoft/vscode#164974、#146330）。
	// 复用占位 EmptyTreeProvider（空树）。
	const badgeView = vscode.window.createTreeView('hyperGit.changesBadge', {
		treeDataProvider: new EmptyTreeProvider(),
	});
	const focusCommitView = (): void => {
		void vscode.commands.executeCommand('hyperGit.commit.focus');
	};

	context.subscriptions.push(
		service,
		registry,
		favorites,
		commit,
		ciService,
		logTree,
		branchesTree,
		stashTree,
		worktreeTree,
		shelfTree,
		blame,
		branchesView,
		badgeView,
		vscode.window.registerWebviewViewProvider(CommitWebviewProvider.viewType, commitView),
		vscode.window.registerWebviewViewProvider(LogWebviewProvider.viewType, logTree),
		vscode.window.registerTreeDataProvider('hyperGit.stash', stashTree),
		vscode.window.createTreeView('hyperGit.shelf', { treeDataProvider: shelfTree }),
		vscode.window.registerTreeDataProvider('hyperGit.worktrees', worktreeTree),
		...registerChangesCommands(service, registry),
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
		vscode.commands.registerCommand('hyperGit.ci.signIn', () => ciService.signIn()),
		vscode.commands.registerCommand('hyperGit.showConsole', () => showGitConsole()),
		vscode.commands.registerCommand('hyperGit.startRebase', () => RebaseWebview.open(service)),
		vscode.languages.registerCodeLensProvider({ scheme: 'file' }, inlineLens),
		registerInlineCommitCommand(service, inlineLens),
	);

	// 活动栏未提交数角标：承载于隐藏的 changesBadge TreeView（见其创建处说明）。
	// 计数复用 service.getChangeCount()（index+工作区+未跟踪去重），为 0 时清空，对齐原生 SCM 行为。
	const updateBadge = (): void => {
		const n = service.getChangeCount();
		badgeView.badge = n > 0 ? { value: n, tooltip: `${n} uncommitted change(s)` } : undefined;
	};

	// 角标走独立快路径（~40ms 微防抖）：面板即便未打开也近实时更新，并合并 add -A/checkout 等事件风暴，
	// 与下方重刷新（150ms）解耦，避免被 log/branches 等高频重拉阻塞。
	let badgeTimer: ReturnType<typeof setTimeout> | undefined;
	const scheduleBadge = (): void => {
		clearTimeout(badgeTimer);
		badgeTimer = setTimeout(updateBadge, 40);
	};

	// git 状态变化频繁（add/checkout/diff 缓存失效均触发），重刷新防抖合并避免 log/stash 高频重拉。
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;
	const refreshAll = (): void => {
		scheduleBadge();
		clearTimeout(refreshTimer);
		refreshTimer = setTimeout(() => {
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
		// 释放期清理悬挂定时器，避免回调触及已 dispose 的视图。
		new vscode.Disposable(() => {
			clearTimeout(badgeTimer);
			clearTimeout(refreshTimer);
		}),
	);
	// 首帧同步：即便后续无事件也确保角标初值正确。
	updateBadge();

	// 首帧保险：若 repo 在 activate 前已就绪，GitRepositoryService 构造函数的 _onDidChange.fire()
	// 早于任何订阅者挂载而被丢失，state.onDidChange 此后可能不再触发。主动刷新一次确保
	// Branches/Log 不停留在首帧空状态（getChildren 内已对未就绪数据做 CLI 兜底与空安全处理）。
	setTimeout(() => {
		branchesTree.refresh();
		logTree.refresh();
		worktreeTree.refresh();
		updateBadge();
	}, 500);
}

export function deactivate(): void {
	// 预留：M3+ 在此释放长生命周期资源。
}
