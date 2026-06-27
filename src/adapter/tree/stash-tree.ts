import * as vscode from 'vscode';
import type { Commit } from '../../types/git';
import type { GitRepositoryService } from '../git-repository-service';

export interface StashEntryNode {
	readonly kind: 'stash';
	readonly index: number;
	readonly commit: Commit;
}

export type StashNode = StashEntryNode;

/**
 * Stash 视图 TreeDataProvider。
 *
 * vscode.git 稳定 API 不暴露 `git stash list`，故用 `Repository.log({ refNames: ['stash'] })`
 * 枚举 stash 提交（stash@{0} 对应最新 = 列表首项，index 即 apply/pop/drop 的索引）。
 * 行级 partial commit / 忠实 patch Shelf 受 API 限制，文档化延后（见 CHANGELOG）。
 */
export class StashTreeProvider implements vscode.TreeDataProvider<StashNode> {
	private readonly _onDidChange = new vscode.EventEmitter<StashNode | undefined>();
	readonly onDidChangeTreeData = this._onDidChange.event;

	constructor(private readonly service: GitRepositoryService) {}

	refresh(): void {
		this._onDidChange.fire(undefined);
	}

	async getChildren(element?: StashNode): Promise<StashNode[]> {
		if (element) {
			return [];
		}
		const repo = this.service.repo;
		if (!repo) {
			return [];
		}
		try {
			const commits = await repo.log({ refNames: ['stash'], maxEntries: 50 });
			return commits.map((c, i): StashEntryNode => ({ kind: 'stash', index: i, commit: c }));
		} catch {
			return [];
		}
	}

	getTreeItem(node: StashNode): vscode.TreeItem {
		const subject = (node.commit.message.split('\n', 1)[0] ?? node.commit.message).slice(0, 60);
		const item = new vscode.TreeItem(subject, vscode.TreeItemCollapsibleState.None);
		item.id = `stash:${node.index}:${node.commit.hash}`;
		item.description = `stash@{${node.index}} · ${node.commit.authorName ?? ''}`;
		item.tooltip = `stash@{${node.index}}\n${node.commit.message}`;
		item.contextValue = 'hyperGit.stash';
		item.iconPath = new vscode.ThemeIcon('archive');
		return item;
	}
}
