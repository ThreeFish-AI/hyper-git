import * as vscode from 'vscode';
import type { GitRepositoryService } from '../git-repository-service';
import { mdTooltip } from './tree-tooltip';

export interface StashEntryNode {
	readonly kind: 'stash';
	readonly index: number;
	readonly message: string;
	/** 相对时间（来自 git stash list --date=relative），可能缺失。 */
	readonly date?: string;
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
			const out = await this.service.execGit(['stash', 'list', '--date=relative']);
			return out
				.split('\n')
				.filter((line) => line.trim().length > 0)
				.map((line): StashEntryNode => {
					const m = line.match(/^stash@\{(\d+)\}:\s*(.*)$/);
					const index = m ? Number(m[1]) : 0;
					let rest = m ? m[2] : line;
					let date: string | undefined;
					// --date=relative 追加形如 "(2 days ago)" 的尾缀：拆出日期，其余留作 message。
					const dm = rest.match(/\s*\(([^)]+)\)\s*$/);
					if (dm && dm.index !== undefined) {
						date = dm[1];
						rest = rest.slice(0, dm.index);
					}
					return { kind: 'stash', index, message: rest, date };
				});
		} catch {
			return [];
		}
	}

	getTreeItem(node: StashNode): vscode.TreeItem {
		const subject = node.message.split(':').slice(1).join(':').trim() || node.message;
		const trimmed = subject.length > 60 ? `${subject.slice(0, 60)}…` : subject;
		const item = new vscode.TreeItem(trimmed, vscode.TreeItemCollapsibleState.None);
		item.id = `stash:${node.index}`;
		item.description = node.date || `stash@{${node.index}}`;
		item.contextValue = 'hyperGit.stash';
		item.iconPath = new vscode.ThemeIcon('archive');
		const rows: Array<[string, string]> = [['Ref', `stash@{${node.index}}`]];
		if (node.date) {
			rows.push(['Date', node.date]);
		}
		rows.push(['Message', subject]);
		item.tooltip = mdTooltip(rows);
		// 单击查看 stash diff（只读，比 apply 更安全；apply/pop/drop 仍在右键菜单）。
		item.command = { command: 'hyperGit.stashView', title: 'View Stash Diff', arguments: [node] };
		return item;
	}

	dispose(): void {
		this._onDidChange.dispose();
	}
}
