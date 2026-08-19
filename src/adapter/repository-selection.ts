import * as vscode from 'vscode';
import type { GitRepositoryService } from './git-repository-service';

/**
 * 仓库选择命令（issue #107 多根工作区）：Graph 工具栏按钮与 Command Palette 共用入口。
 *
 * - 带参调用（root 路径）= 程序化切换（集成测试接缝，无 UI）；
 * - 无参 = QuickPick 交互（Git Graph 形态：仓库名 + 完整路径，当前项预选）；
 * - 单仓库时提示 no-op；零仓库静默返回（对齐全扩展「无 repo 短路」惯例）。
 */
export function registerRepositorySelectionCommand(service: GitRepositoryService): vscode.Disposable {
	return vscode.commands.registerCommand('hyperGit.selectRepository', async (root?: string) => {
		const repos = service.listRepositories();
		if (repos.length === 0) {
			return;
		}
		if (root !== undefined) {
			// 程序化切换：失败给出可见反馈（仓库可能已被移除）。
			if (!service.selectRepository(root)) {
				void vscode.window.showWarningMessage('Repository is no longer available');
			}
			return;
		}
		if (repos.length === 1) {
			void vscode.window.showInformationMessage('Only one Git repository in this workspace');
			return;
		}
		const current = service.repoRoot;
		const items = repos.map((r) => ({
			label: `$(repo) ${r.rootPath.split(/[\\/]/).filter(Boolean).pop() ?? r.rootPath}`,
			description: r.rootPath,
			rootPath: r.rootPath,
			picked: r.rootPath === current,
		}));
		const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select Git Repository' });
		if (!pick) {
			return;
		}
		if (!service.selectRepository(pick.rootPath)) {
			void vscode.window.showWarningMessage('Repository is no longer available');
		}
	});
}
