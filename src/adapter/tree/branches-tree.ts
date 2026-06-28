import * as vscode from 'vscode';
import type { Ref } from '../../types/git';
import type { GitRepositoryService } from '../git-repository-service';
import { FOR_EACH_REF_FORMAT, type RawRef, parseForEachRef } from '../../engine/ref/for-each-ref';

export interface BranchGroupNode {
	readonly kind: 'group';
	readonly id: 'local' | 'remote';
	readonly label: string;
}

export interface BranchRefNode {
	readonly kind: 'branch';
	readonly ref: RawRef;
	readonly remote: boolean;
}

export type BranchNode = BranchGroupNode | BranchRefNode;

/**
 * Branches 视图 TreeDataProvider。
 *
 * 数据源策略（解除「视图空白」根因）：主路径读 `Repository.state.refs`（API，零成本）；
 * 为空（首帧未填充 / 仓库初始化竞态）时经 CLI 通道 `git for-each-ref` 兜底（复用
 * stash-tree 的稳定范式）。两者统一归一为 {@link RawRef}，渲染逻辑单一。构造函数自订阅
 * `service.onDidChange` 做即时刷新（与 extension 的防抖 refreshAll 互补）。
 */
export class BranchesTreeProvider implements vscode.TreeDataProvider<BranchNode>, vscode.Disposable {
	private readonly _onDidChange = new vscode.EventEmitter<BranchNode | undefined>();
	readonly onDidChangeTreeData = this._onDidChange.event;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly service: GitRepositoryService) {
		this.disposables.push(service.onDidChange(() => this.refresh()));
	}

	refresh(): void {
		this._onDidChange.fire(undefined);
	}

	async getChildren(element?: BranchNode): Promise<BranchNode[]> {
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
			const wantRemote = element.id === 'remote';
			const refs = await this.loadRefs();
			return refs
				.filter((r) => !r.isTag && r.isRemote === wantRemote)
				.map((r): BranchRefNode => ({ kind: 'branch', ref: r, remote: r.isRemote }));
		}
		return [];
	}

	/**
	 * 读取分支列表：优先 `repo.state.refs`（API，零成本）；为空时 CLI 兜底 `git for-each-ref`。
	 * 两者归一为 RawRef，保证渲染与下游操作（checkout/compare/merge…）逻辑单一。
	 */
	private async loadRefs(): Promise<RawRef[]> {
		const apiRefs = this.service.repo?.state.refs ?? [];
		if (apiRefs.length > 0) {
			return apiRefs.map(refToRaw);
		}
		try {
			const out = await this.service.execGit([
				'for-each-ref',
				`--format=${FOR_EACH_REF_FORMAT}`,
				'refs/heads',
				'refs/remotes',
				'refs/tags',
			]);
			return parseForEachRef(out);
		} catch {
			return [];
		}
	}

	getTreeItem(element: BranchNode): vscode.TreeItem {
		if (element.kind === 'group') {
			const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
			item.contextValue = 'hyperGit.branchGroup';
			item.iconPath = new vscode.ThemeIcon(element.id === 'remote' ? 'repo' : 'git-branch');
			return item;
		}
		const ref = element.ref;
		const active = this.isActive(ref);
		const item = new vscode.TreeItem(ref.shortName, vscode.TreeItemCollapsibleState.None);
		item.description = active ? 'active' : (ref.objectname || '');
		item.contextValue = element.remote ? 'hyperGit.remoteBranch' : 'hyperGit.branch';
		item.tooltip = `${ref.shortName}${active ? ' (active)' : ''}${ref.upstream ? `\n← ${ref.upstream}` : ''}`;
		item.iconPath = new vscode.ThemeIcon(
			element.remote ? 'cloud' : 'git-branch',
			active ? new vscode.ThemeColor('gitDecoration.modifiedResourceForeground') : undefined,
		);
		return item;
	}

	/** 判定分支是否当前 HEAD：CLI 解析的 head 标记优先，API 路径回退与 state.HEAD.name 比较。 */
	private isActive(ref: RawRef): boolean {
		if (ref.head) {
			return true;
		}
		const headName = this.service.repo?.state.HEAD?.name;
		return !!headName && headName === ref.shortName;
	}

	dispose(): void {
		this.disposables.forEach((d) => d.dispose());
		this._onDidChange.dispose();
	}
}

/** vscode.git Ref → RawRef 归一（API 路径；head 留空，由 isActive 兜底）。 */
function refToRaw(r: Ref): RawRef {
	return {
		refname: r.name ?? '',
		shortName: r.name ?? '',
		objectname: r.commit?.slice(0, 7) ?? '',
		upstream: undefined,
		head: false,
		isRemote: r.type === 1,
		isTag: r.type === 2,
	};
}
