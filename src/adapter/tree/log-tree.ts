import * as vscode from 'vscode';
import type { Commit } from '../../types/git';
import type { GitRepositoryService } from '../git-repository-service';
import { applyClientFilters, safeRegex, type LogClientFilter, type MergeMode } from '../../engine/log/log-filter';
import { parseNameStatus, statusLabel, type CommitFileChange } from '../../engine/log/commit-files';

export interface LogCommitNode {
	readonly kind: 'commit';
	readonly commit: Commit;
}

export interface LogFileNode {
	readonly kind: 'file';
	readonly hash: string;
	readonly change: CommitFileChange;
	readonly hasParent: boolean;
}

export type LogNode = LogCommitNode | LogFileNode;

/** Log 过滤器：author/path/grep 交 git log 服务端；mergeMode/dateFrom/dateTo/messageRegex 客户端。 */
export interface LogFilter {
	readonly author?: string;
	readonly path?: string;
	readonly grep?: string;
	readonly mergeMode?: MergeMode;
	readonly dateFrom?: Date;
	readonly dateTo?: Date;
	/** message 正则模式串（运行时经 safeRegex 编译）。 */
	readonly messageRegex?: string;
}

/**
 * Log 视图 TreeDataProvider：消费 `Repository.log()`，支持多维过滤；commit 节点可展开显示
 * 该提交的变更文件（`git diff-tree --name-status`），单文件点击打开 diff（commit^ vs commit）。
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
		const repo = this.service.repo;
		if (!repo) {
			return [];
		}
		if (element) {
			return element.kind === 'commit' ? this.commitFiles(element.commit) : [];
		}
		try {
			const commits = await repo.log({
				maxEntries: 200,
				author: this.filter.author,
				path: this.filter.path,
				grep: this.filter.grep,
			});
			const clientFilter: LogClientFilter = {
				mergeMode: this.filter.mergeMode,
				dateFrom: this.filter.dateFrom,
				dateTo: this.filter.dateTo,
				messageRegex: this.filter.messageRegex ? safeRegex(this.filter.messageRegex) : undefined,
			};
			return applyClientFilters(commits, clientFilter).map((c): LogCommitNode => ({ kind: 'commit', commit: c }));
		} catch {
			return [];
		}
	}

	/** 展开 commit：经 diff-tree 取变更文件列表。 */
	private async commitFiles(commit: Commit): Promise<LogFileNode[]> {
		try {
			const out = await this.service.execGit([
				'diff-tree',
				'--no-commit-id',
				'--name-status',
				'-r',
				'--root',
				commit.hash,
			]);
			const hasParent = commit.parents.length > 0;
			return parseNameStatus(out).map((change): LogFileNode => ({ kind: 'file', hash: commit.hash, change, hasParent }));
		} catch {
			return [];
		}
	}

	getTreeItem(node: LogNode): vscode.TreeItem {
		if (node.kind === 'file') {
			return this.createFileItem(node);
		}
		return this.createCommitItem(node.commit);
	}

	private createCommitItem(c: Commit): vscode.TreeItem {
		const subject = (c.message.split('\n', 1)[0] ?? c.message).slice(0, 80);
		const date = c.authorDate ? formatDate(c.authorDate) : '';
		const isMerge = c.parents.length > 1;
		const item = new vscode.TreeItem(subject, vscode.TreeItemCollapsibleState.Collapsed);
		item.id = c.hash;
		item.description = `${c.authorName ?? '?'} · ${date} · ${c.hash.slice(0, 7)}${isMerge ? ' · merge' : ''}`;
		item.tooltip = `${c.hash}\n${c.authorName ?? ''} <${c.authorEmail ?? ''}> · ${date}\n\n${c.message}`;
		item.contextValue = 'hyperGit.commit';
		item.iconPath = new vscode.ThemeIcon(isMerge ? 'git-merge' : 'git-commit');
		return item;
	}

	private createFileItem(node: LogFileNode): vscode.TreeItem {
		const { change, hash, hasParent } = node;
		const label = change.oldPath ? `${change.oldPath} → ${change.path}` : change.path;
		const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
		item.description = statusLabel(change.status);
		item.contextValue = 'hyperGit.commitFile';
		item.tooltip = `${statusLabel(change.status)} · ${change.path}\n@ ${hash.slice(0, 7)}`;
		item.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor(fileIconColor(change.status)));
		item.command = {
			command: 'hyperGit.openCommitFileDiff',
			title: '打开 Diff',
			arguments: [hash, change.path, hasParent],
		};
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

function fileIconColor(status: string): string {
	if (status.startsWith('A')) {
		return 'gitDecoration.addedResourceForeground';
	}
	if (status.startsWith('D')) {
		return 'gitDecoration.deletedResourceForeground';
	}
	if (status.startsWith('R') || status.startsWith('C')) {
		return 'gitDecoration.renamedResourceForeground';
	}
	return 'gitDecoration.modifiedResourceForeground';
}
