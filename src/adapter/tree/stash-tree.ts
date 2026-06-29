import * as vscode from 'vscode';
import type { GitRepositoryService } from '../git-repository-service';

export interface StashEntryNode {
	readonly kind: 'stash';
	readonly index: number;
	readonly message: string;
}

export type StashNode = StashEntryNode;

/**
 * Stash 视图 TreeDataProvider。
 *
 * vscode.git 稳定 API 不暴露 `git stash list`（`log({ refNames: ['stash'] })` 仅返回最新 stash 的
 * 内部提交，语义错误）。故改用受控 CLI 通道 `service.execGit(['stash','list'])` 枚举真实 stash 栈，
 * index 与 `stash@{n}` 严格对应（供 apply/pop/drop）。
 */
export class StashTreeProvider implements vscode.TreeDataProvider<StashNode>, vscode.Disposable {
	private readonly _onDidChange = new vscode.EventEmitter<StashNode | undefined>();
	readonly onDidChangeTreeData = this._onDidChange.event;

	constructor(private readonly service: GitRepositoryService) {}

	refresh(): void {
		this._onDidChange.fire(undefined);
	}

	async getChildren(): Promise<StashNode[]> {
		const repo = this.service.repo;
		if (!repo) {
			return [];
		}
		try {
			const out = await this.service.execGit(['stash', 'list']);
			return out
				.split('\n')
				.filter((line) => line.trim().length > 0)
				.map((line): StashEntryNode => {
					const m = line.match(/^stash@\{(\d+)\}:\s*(.*)$/);
					return { kind: 'stash', index: m ? Number(m[1]) : 0, message: m ? m[2] : line };
				});
		} catch {
			return [];
		}
	}

	getTreeItem(node: StashNode): vscode.TreeItem {
		const subject = node.message.split(':').slice(1).join(':').trim() || node.message;
		const item = new vscode.TreeItem(subject.slice(0, 60), vscode.TreeItemCollapsibleState.None);
		item.id = `stash:${node.index}`;
		item.description = `stash@{${node.index}}`;
		item.tooltip = `stash@{${node.index}}\n${node.message}`;
		item.contextValue = 'hyperGit.stash';
		item.iconPath = new vscode.ThemeIcon('archive');
		return item;
	}

	dispose(): void {
		this._onDidChange.dispose();
	}
}
