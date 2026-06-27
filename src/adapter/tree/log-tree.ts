import * as vscode from 'vscode';
import type { Commit } from '../../types/git';
import type { GitRepositoryService } from '../git-repository-service';

export interface LogCommitNode {
	readonly kind: 'commit';
	readonly commit: Commit;
}

export type LogNode = LogCommitNode;

export interface LogFilter {
	readonly author?: string;
	readonly path?: string;
}

/**
 * Log 视图 TreeDataProvider：消费 `Repository.log()`，按 author/path 过滤。
 * 完整提交图（SVG 拓扑连线）作为后续增强（M3.x）；当前以提交列表 + 过滤 + copy hash 提供核心浏览能力。
 */
export class LogTreeProvider implements vscode.TreeDataProvider<LogNode>, vscode.Disposable {
	private readonly _onDidChange = new vscode.EventEmitter<LogNode | undefined>();
	readonly onDidChangeTreeData = this._onDidChange.event;
	private filter: LogFilter = {};

	constructor(private readonly service: GitRepositoryService) {}

	setFilter(filter: LogFilter): void {
		this.filter = filter;
		this._onDidChange.fire(undefined);
	}

	clearFilter(): void {
		this.filter = {};
		this._onDidChange.fire(undefined);
	}

	getFilter(): LogFilter {
		return this.filter;
	}

	refresh(): void {
		this._onDidChange.fire(undefined);
	}

	async getChildren(element?: LogNode): Promise<LogNode[]> {
		if (element) {
			return [];
		}
		const repo = this.service.repo;
		if (!repo) {
			return [];
		}
		try {
			const commits = await repo.log({ maxEntries: 200, author: this.filter.author, path: this.filter.path });
			return commits.map((c): LogCommitNode => ({ kind: 'commit', commit: c }));
		} catch {
			return [];
		}
	}

	getTreeItem(node: LogNode): vscode.TreeItem {
		const c = node.commit;
		const subject = (c.message.split('\n', 1)[0] ?? c.message).slice(0, 80);
		const date = c.authorDate ? formatDate(c.authorDate) : '';
		const item = new vscode.TreeItem(subject, vscode.TreeItemCollapsibleState.None);
		item.id = c.hash;
		item.description = `${c.authorName ?? '?'} · ${date} · ${c.hash.slice(0, 7)}`;
		item.tooltip = `${c.hash}\n${c.authorName ?? ''} <${c.authorEmail ?? ''}> · ${date}\n\n${c.message}`;
		item.contextValue = 'hyperGit.commit';
		item.iconPath = new vscode.ThemeIcon('git-commit');
		return item;
	}

	dispose(): void {
		this._onDidChange.dispose();
	}
}

function formatDate(d: Date): string {
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${d.getFullYear()}-${m}-${day}`;
}
