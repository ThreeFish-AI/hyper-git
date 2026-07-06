import * as path from 'path';
import * as vscode from 'vscode';
import { FileStatus } from '../engine/model';
import { diffShapeFromStatus } from '../engine/diff/change-side';
import { resolveDiffSides } from './diff-sides';
import type { ChangelistRegistry } from './changelist-registry';
import type { ChangeItem, GitRepositoryService } from './git-repository-service';

/** 命令实参可能来自 webview（路径字符串）或旧式节点对象（含 id/item）。 */
function asId(arg: unknown): string | undefined {
	if (typeof arg === 'string') {
		return arg;
	}
	if (arg && typeof arg === 'object' && typeof (arg as { id?: unknown }).id === 'string') {
		return (arg as { id: string }).id;
	}
	return undefined;
}

/**
 * 注册 Changes / Commit 相关命令（M1；原 Changes 树移除后由 Commit webview 复用）。
 *
 * 文件级命令统一接受 `ChangeItem | 路径字符串`：webview 传路径，host 经 {@link resolveChange}
 * 回落到 `service.getChanges()` 解析为 ChangeItem（单一事实源）。视图刷新由 registry/service
 * 的 onDidChange → extension.refreshAll → commitView.refresh() 驱动，命令内不再直接刷新视图。
 */
export function registerChangesCommands(
	service: GitRepositoryService,
	registry: ChangelistRegistry,
): vscode.Disposable[] {
	const subs: vscode.Disposable[] = [];

	const resolveChange = (arg?: ChangeItem | string): ChangeItem | undefined => {
		if (arg && typeof arg !== 'string') {
			return arg;
		}
		if (typeof arg === 'string') {
			return service.getChanges().find((c) => c.relativePath === arg);
		}
		return undefined;
	};

	subs.push(
		vscode.commands.registerCommand('hyperGit.refresh', async () => {
			// 重扫 git 状态；state 变化经 onDidChange → refreshAll 刷新 Commit/Log/Branches 等视图。
			await service.repo?.status();
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.newChangelist', async () => {
			const name = await vscode.window.showInputBox({ prompt: 'New Changelist name', placeHolder: 'e.g. feature-x' });
			if (name && name.trim()) {
				registry.create(name.trim());
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.setActiveChangelist', (arg: unknown) => {
			const id = asId(arg);
			if (id) {
				registry.setActive(id);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.renameChangelist', async (arg: unknown) => {
			const id = asId(arg);
			if (!id) {
				return;
			}
			const def = registry.getDef(id);
			const name = await vscode.window.showInputBox({ prompt: 'Rename Changelist', value: def?.name });
			if (name && name.trim()) {
				registry.rename(id, name.trim());
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.deleteChangelist', async (arg: unknown) => {
			const id = asId(arg);
			if (!id) {
				return;
			}
			const name = registry.getDef(id)?.name ?? id;
			const choice = await vscode.window.showWarningMessage(
				`Delete Changelist "${name}"? Files under it will be moved to the default list.`,
				{ modal: true },
				'Delete',
			);
			if (choice === 'Delete') {
				registry.remove(id);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.moveChangelist', async (arg: ChangeItem | string) => {
			const change = resolveChange(arg);
			if (!change) {
				return;
			}
			const active = registry.activeChangelistId;
			const groups = registry.getGroups(service.getChanges(), (c) => c.relativePath);
			const currentId = groups.find((g) => g.items.some((i) => i.relativePath === change.relativePath))?.id;
			const picks = registry
				.listDefs()
				.map((d) => ({ label: d.name, id: d.id, description: d.id === active ? 'active' : undefined, picked: d.id === currentId }));
			const pick = await vscode.window.showQuickPick(picks, { placeHolder: 'Move file to Changelist' });
			if (pick) {
				registry.move(change.relativePath, pick.id);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.openDiff', async (arg: ChangeItem | string) => {
			const repo = service.repo;
			const change = resolveChange(arg);
			if (!repo || !change) {
				return;
			}
			// 按变更形态选择差异端点：新增置空旧端、删除置空新端、重命名旧端取原路径；缺失端统一走 git 空树 ref
			// （跨 VS Code 版本稳定回空），避免对不存在对象取 'HEAD' 致新版差异打不开。空树在无 HEAD 的空仓库下亦成立。
			const shape = diffShapeFromStatus(change.status);
			const oldUri = shape === 'renamed' ? change.originalUri : change.uri;
			const { left, right } = resolveDiffSides(
				service,
				shape,
				oldUri,
				service.toGitUri(oldUri, 'HEAD'),
				change.uri,
				change.uri,
			);
			const title = `${path.basename(change.relativePath)} (HEAD ↔ Working)`;
			try {
				await vscode.commands.executeCommand('vscode.diff', left, right, title);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to open diff: ${e instanceof Error ? e.message : String(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.discardChanges', async (arg: ChangeItem | string) => {
			const repo = service.repo;
			const change = resolveChange(arg);
			if (!repo || !change) {
				return;
			}
			const choice = await vscode.window.showWarningMessage(
				`Discard changes to "${change.relativePath}"? This action cannot be undone.`,
				{ modal: true },
				'Discard',
			);
			if (choice !== 'Discard') {
				return;
			}
			try {
				// 未跟踪文件用 clean（删除）；已跟踪的改动用 restore（丢弃工作区改动）。
				// 视图刷新由 service.onDidChange → refreshAll 驱动。
				if (change.status === FileStatus.Untracked) {
					await repo.clean([change.uri.fsPath]);
				} else {
					await repo.restore([change.uri.fsPath]);
				}
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to discard: ${e instanceof Error ? e.message : String(e)}`);
			}
		}),
	);

	return subs;
}
