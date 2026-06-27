import * as path from 'path';
import * as vscode from 'vscode';
import { FileStatus } from '../engine/model';
import type { ChangelistRegistry } from './changelist-registry';
import type { ChangeItem, GitRepositoryService } from './git-repository-service';
import type { ChangesNode, ChangesTreeProvider } from './tree/changes-tree';

/** 注册 Changes 视图相关命令（M1）。 */
export function registerChangesCommands(
	service: GitRepositoryService,
	registry: ChangelistRegistry,
	tree: ChangesTreeProvider,
): vscode.Disposable[] {
	const subs: vscode.Disposable[] = [];

	subs.push(
		vscode.commands.registerCommand('hyperGit.refresh', async () => {
			await service.repo?.status();
			tree.refresh();
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.newChangelist', async () => {
			const name = await vscode.window.showInputBox({ prompt: '新建 Changelist 名称', placeHolder: '例如 feature-x' });
			if (name && name.trim()) {
				registry.create(name.trim());
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.setActiveChangelist', (node: ChangesNode) => {
			if (node?.kind === 'changelist') {
				registry.setActive(node.id);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.renameChangelist', async (node: ChangesNode) => {
			if (node?.kind !== 'changelist') {
				return;
			}
			const def = registry.getDef(node.id);
			const name = await vscode.window.showInputBox({ prompt: '重命名 Changelist', value: def?.name });
			if (name && name.trim()) {
				registry.rename(node.id, name.trim());
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.deleteChangelist', async (node: ChangesNode) => {
			if (node?.kind !== 'changelist') {
				return;
			}
			const choice = await vscode.window.showWarningMessage(
				`删除 Changelist「${node.name}」？其下文件将归入默认列表。`,
				{ modal: true },
				'删除',
			);
			if (choice === '删除') {
				registry.remove(node.id);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.moveChangelist', async (node: ChangesNode) => {
			if (node?.kind !== 'file') {
				return;
			}
			const active = registry.activeChangelistId;
			const picks = registry
				.listDefs()
				.map((d) => ({ label: d.name, id: d.id, description: d.id === active ? 'active' : undefined, picked: d.id === node.changelistId }));
			const pick = await vscode.window.showQuickPick(picks, { placeHolder: '将文件移至 Changelist' });
			if (pick) {
				registry.move(node.item.relativePath, pick.id);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.openDiff', async (change: ChangeItem) => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			// 空仓库（无 HEAD）时用 originalUri 兜底，避免 git scheme 解析失败
			const left = repo.state.HEAD ? service.toGitUri(change.uri, 'HEAD') : change.originalUri;
			const right = change.uri;
			const title = `${path.basename(change.relativePath)} (HEAD ↔ Working)`;
			await vscode.commands.executeCommand('vscode.diff', left, right, title);
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.discardChanges', async (change: ChangeItem) => {
			const repo = service.repo;
			if (!repo || !change) {
				return;
			}
			const choice = await vscode.window.showWarningMessage(
				`丢弃「${change.relativePath}」的改动？此操作不可撤销。`,
				{ modal: true },
				'丢弃',
			);
			if (choice !== '丢弃') {
				return;
			}
			try {
				// 未跟踪文件用 clean（删除）；已跟踪的改动用 restore（丢弃工作区改动）
				if (change.status === FileStatus.Untracked) {
					await repo.clean([change.uri.fsPath]);
				} else {
					await repo.restore([change.uri.fsPath]);
				}
				tree.refresh();
			} catch (e) {
				void vscode.window.showErrorMessage(`丢弃失败：${e instanceof Error ? e.message : String(e)}`);
			}
		}),
	);

	return subs;
}
