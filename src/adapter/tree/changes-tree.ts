import * as path from 'path';
import * as vscode from 'vscode';
import { fileStatusLabel } from '../../engine/model';
import { getDecoration } from '../../engine/scm-mapping/status-decoration';
import type { ChangelistRegistry } from '../changelist-registry';
import type { ChangeItem, GitRepositoryService } from '../git-repository-service';

export interface ChangesChangelistNode {
	readonly kind: 'changelist';
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	readonly active: boolean;
	readonly items: readonly ChangeItem[];
}

export interface ChangesFileNode {
	readonly kind: 'file';
	readonly item: ChangeItem;
	readonly changelistId: string;
}

export type ChangesNode = ChangesChangelistNode | ChangesFileNode;

/**
 * Changes 视图 TreeDataProvider：changelist 一级节点 + 文件叶子。
 * 状态色用 ThemeIcon(circle-filled) + gitDecoration 主题色；文件单击打开原生 diff。
 */
export class ChangesTreeProvider implements vscode.TreeDataProvider<ChangesNode> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<ChangesNode | undefined>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(
		private readonly service: GitRepositoryService,
		private readonly registry: ChangelistRegistry,
	) {}

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	getChildren(element?: ChangesNode): ChangesNode[] {
		if (!element) {
			const items = this.service.getChanges();
			const groups = this.registry.getGroups(items, (i) => i.relativePath);
			return groups
				.filter((g) => g.active || g.items.length > 0)
				.map((g): ChangesChangelistNode => ({
					kind: 'changelist',
					id: g.id,
					name: g.name,
					description: g.description,
					active: g.active,
					items: g.items,
				}));
		}
		if (element.kind === 'changelist') {
			return element.items.map((item): ChangesFileNode => ({ kind: 'file', item, changelistId: element.id }));
		}
		return [];
	}

	getTreeItem(element: ChangesNode): vscode.TreeItem {
		if (element.kind === 'changelist') {
			return this.createChangelistItem(element);
		}
		return this.createFileItem(element);
	}

	private createChangelistItem(node: ChangesChangelistNode): vscode.TreeItem {
		const count = node.items.length;
		const state = count > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;
		const item = new vscode.TreeItem(node.name, state);
		item.contextValue = 'hyperGit.changelist';
		item.id = `cl:${node.id}`;
		item.iconPath = new vscode.ThemeIcon('folder');
		item.description = `${count} ${count === 1 ? 'file' : 'files'}${node.active ? ' · active' : ''}`;
		item.tooltip = `${node.name}${node.active ? ' (active)' : ''}\n${count} changes`;
		return item;
	}

	private createFileItem(node: ChangesFileNode): vscode.TreeItem {
		const change = node.item;
		const decoration = getDecoration(change.status);
		const dir = path.dirname(change.relativePath);
		const treeItem = new vscode.TreeItem(path.basename(change.relativePath), vscode.TreeItemCollapsibleState.None);
		treeItem.contextValue = 'hyperGit.fileChange';
		treeItem.id = `file:${change.relativePath}`;
		treeItem.resourceUri = change.uri;
		treeItem.description = `${decoration.letter}${dir && dir !== '.' ? ' · ' + dir : ''}`;
		treeItem.tooltip = `${change.relativePath}\n状态：${fileStatusLabel(change.status)}${change.staged ? '（已暂存）' : ''}`;
		treeItem.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor(decoration.themeColor));
		treeItem.command = { command: 'hyperGit.openDiff', title: '打开 Diff', arguments: [change] };
		return treeItem;
	}
}

/** 无 git 时的占位 provider（空树，触发 viewsWelcome）。 */
export class EmptyChangesProvider implements vscode.TreeDataProvider<never> {
	getTreeItem(): vscode.TreeItem {
		return new vscode.TreeItem('');
	}
	getChildren(): never[] {
		return [];
	}
}
