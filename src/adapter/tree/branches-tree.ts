import * as vscode from 'vscode';
import type { Ref } from '../../types/git';
import type { GitRepositoryService } from '../git-repository-service';

export interface BranchGroupNode {
	readonly kind: 'group';
	readonly id: 'local' | 'remote';
	readonly label: string;
}

export interface BranchRefNode {
	readonly kind: 'branch';
	readonly ref: Ref;
	readonly remote: boolean;
}

export type BranchNode = BranchGroupNode | BranchRefNode;

/** Branches 视图 TreeDataProvider：消费 `Repository.state.refs`（本地 + 远程分支）。 */
export class BranchesTreeProvider implements vscode.TreeDataProvider<BranchNode>, vscode.Disposable {
	private readonly _onDidChange = new vscode.EventEmitter<BranchNode | undefined>();
	readonly onDidChangeTreeData = this._onDidChange.event;

	constructor(private readonly service: GitRepositoryService) {}

	refresh(): void {
		this._onDidChange.fire(undefined);
	}

	getChildren(element?: BranchNode): BranchNode[] {
		const repo = this.service.repo;
		if (!repo) {
			return [];
		}
		if (!element) {
			return [
				{ kind: 'group', id: 'local', label: 'Local Branches' },
				{ kind: 'group', id: 'remote', label: 'Remote Branches' },
			];
		}
		if (element.kind === 'group') {
			const type = element.id === 'remote' ? 1 : 0; // RefType: 0=Head, 1=RemoteHead
			return repo.state.refs
				.filter((r) => r.type === type && r.name)
				.map((r): BranchRefNode => ({ kind: 'branch', ref: r, remote: element.id === 'remote' }));
		}
		return [];
	}

	getTreeItem(element: BranchNode): vscode.TreeItem {
		if (element.kind === 'group') {
			const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
			item.contextValue = 'hyperGit.branchGroup';
			item.iconPath = new vscode.ThemeIcon(element.id === 'remote' ? 'repo' : 'git-branch');
			return item;
		}
		const ref = element.ref;
		const head = this.service.repo?.state.HEAD;
		const active = !!head?.name && head.name === ref.name;
		const item = new vscode.TreeItem(ref.name ?? '', vscode.TreeItemCollapsibleState.None);
		item.description = active ? 'active' : (ref.commit?.slice(0, 7) ?? '');
		item.contextValue = element.remote ? 'hyperGit.remoteBranch' : 'hyperGit.branch';
		item.tooltip = `${ref.name ?? ''}${active ? ' (active)' : ''}`;
		item.iconPath = new vscode.ThemeIcon(element.remote ? 'cloud' : 'git-branch', active ? new vscode.ThemeColor('gitDecoration.modifiedResourceForeground') : undefined);
		return item;
	}

	dispose(): void {
		this._onDidChange.dispose();
	}
}
