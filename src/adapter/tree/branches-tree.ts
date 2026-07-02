import * as vscode from 'vscode';
import type { Ref } from '../../types/git';
import type { GitRepositoryService } from '../git-repository-service';
import type { BranchFavorites } from '../branch-favorites';
import { FOR_EACH_REF_FORMAT, type RawRef, parseForEachRef } from '../../engine/ref/for-each-ref';
import { mdTooltip } from './tree-tooltip';

export type BranchGroupId = 'favorites' | 'local' | 'remote' | 'tags';

export interface BranchGroupNode {
	readonly kind: 'group';
	readonly id: BranchGroupId;
	readonly label: string;
	/** 分组内条目数（标题栏描述显示计数徽标）。 */
	readonly count: number;
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
 * 为空（首帧未填充 / 仓库初始化竞态）时经 CLI 通道 `git for-each-ref` 兜底（含 ahead/behind track）。
 * 四段分组：Favorites（收藏置顶，参考 JetBrains 分组设计）/ Local / Remote / Tags。
 * 构造函数自订阅 service.onDidChange + favorites.onDidChange 做即时刷新。
 */
export class BranchesTreeProvider implements vscode.TreeDataProvider<BranchNode>, vscode.Disposable {
	private readonly _onDidChange = new vscode.EventEmitter<BranchNode | undefined>();
	readonly onDidChangeTreeData = this._onDidChange.event;
	private readonly disposables: vscode.Disposable[] = [];
	private refsCache: RawRef[] | undefined;
	private refsInFlight: Promise<RawRef[]> | undefined;

	constructor(
		private readonly service: GitRepositoryService,
		private readonly favorites: BranchFavorites,
	) {
		this.disposables.push(service.onDidChange(() => this.refresh()));
		this.disposables.push(favorites.onDidChange(() => this.refresh()));
	}

	refresh(): void {
		this.refsCache = undefined;
		this._onDidChange.fire(undefined);
	}

	async getChildren(element?: BranchNode): Promise<BranchNode[]> {
		const repo = this.service.repo;
		if (!repo) {
			return [];
		}
		if (!element) {
			const refs = await this.loadRefs();
			const byName = new Map(refs.map((r) => [r.shortName, r] as const));
			const favCount = this.favorites.list().filter((n) => byName.has(n)).length;
			const localCount = refs.filter((r) => !r.isRemote && !r.isTag).length;
			const remoteCount = refs.filter((r) => r.isRemote).length;
			const tagCount = refs.filter((r) => r.isTag).length;
			const groups: BranchGroupNode[] = [];
			if (favCount > 0) {
				groups.push({ kind: 'group', id: 'favorites', label: 'Favorites', count: favCount });
			}
			groups.push(
				{ kind: 'group', id: 'local', label: 'Local Branches', count: localCount },
				{ kind: 'group', id: 'remote', label: 'Remote Branches', count: remoteCount },
			);
			if (tagCount > 0) {
				groups.push({ kind: 'group', id: 'tags', label: 'Tags', count: tagCount });
			}
			return groups;
		}
		if (element.kind === 'group') {
			const refs = await this.loadRefs();
			switch (element.id) {
				case 'favorites':
					return this.favoriteNodes(refs);
				case 'local':
					return this.sortLocal(refs.filter((r) => !r.isRemote && !r.isTag)).map((r) => this.toNode(r));
				case 'remote':
					return refs
						.filter((r) => r.isRemote)
						.sort((a, b) => a.shortName.localeCompare(b.shortName))
						.map((r) => this.toNode(r));
				case 'tags':
					return refs
						.filter((r) => r.isTag)
						.sort((a, b) => a.shortName.localeCompare(b.shortName))
						.map((r) => this.toNode(r));
			}
		}
		return [];
	}

	private toNode(r: RawRef): BranchRefNode {
		return { kind: 'branch', ref: r, remote: r.isRemote };
	}

	/** Favorites 段：按收藏插入顺序展示已收藏且仍存在的分支。 */
	private favoriteNodes(refs: RawRef[]): BranchNode[] {
		const byName = new Map(refs.map((r) => [r.shortName, r] as const));
		const nodes: BranchNode[] = [];
		for (const name of this.favorites.list()) {
			const r = byName.get(name);
			if (r) {
				nodes.push(this.toNode(r));
			}
		}
		return nodes;
	}

	/** Local 段排序：当前 HEAD → 收藏 → 字母序。 */
	private sortLocal(refs: RawRef[]): RawRef[] {
		const favSet = new Set(this.favorites.list());
		return [...refs].sort((a, b) => {
			const aActive = this.isActive(a) ? 0 : 1;
			const bActive = this.isActive(b) ? 0 : 1;
			if (aActive !== bActive) {
				return aActive - bActive;
			}
			const aFav = favSet.has(a.shortName) ? 0 : 1;
			const bFav = favSet.has(b.shortName) ? 0 : 1;
			if (aFav !== bFav) {
				return aFav - bFav;
			}
			return a.shortName.localeCompare(b.shortName);
		});
	}

	/**
	 * 读取分支列表：优先 `repo.state.refs`（API，零成本）；为空时 CLI 兜底 `git for-each-ref`。
	 * 带 in-flight 去重缓存，避免多段并发展开重复 spawn CLI；refresh() 清缓存。
	 */
	private loadRefs(): Promise<RawRef[]> {
		if (this.refsCache) {
			return Promise.resolve(this.refsCache);
		}
		if (this.refsInFlight) {
			return this.refsInFlight;
		}
		this.refsInFlight = (async () => {
			const apiRefs = this.service.repo?.state.refs ?? [];
			const refs = apiRefs.length > 0 ? apiRefs.map(refToRaw) : await this.cliRefs();
			this.refsCache = refs;
			this.refsInFlight = undefined;
			return refs;
		})();
		return this.refsInFlight;
	}

	private async cliRefs(): Promise<RawRef[]> {
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
			item.description = String(element.count);
			const icon =
				element.id === 'remote' ? 'repo' : element.id === 'tags' ? 'tag' : element.id === 'favorites' ? 'star-full' : 'git-branch';
			item.iconPath = new vscode.ThemeIcon(icon);
			return item;
		}
		const ref = element.ref;
		const active = this.isActive(ref);
		const fav = this.favorites.isFavorite(ref.shortName);
		const isTag = ref.isTag;
		const item = new vscode.TreeItem(ref.shortName, vscode.TreeItemCollapsibleState.None);
		item.description = this.describe(ref, active);
		item.contextValue = isTag ? 'hyperGit.tag' : element.remote ? 'hyperGit.remoteBranch' : 'hyperGit.branch';
		item.tooltip = this.tooltip(ref, active, fav);
		const icon = isTag ? 'tag' : element.remote ? 'cloud' : 'git-branch';
		// 活动分支 = charts.blue（与 Log 本地分支 chip 同语义，全局一致）；收藏（非活动）= charts.yellow。
		const color = active
			? new vscode.ThemeColor('charts.blue')
			: fav
				? new vscode.ThemeColor('charts.yellow')
				: undefined;
		item.iconPath = new vscode.ThemeIcon(icon, color);
		return item;
	}

	private describe(ref: RawRef, active: boolean): string {
		const parts: string[] = [];
		if (active) {
			parts.push('active');
		} else if (ref.ahead || ref.behind) {
			if (ref.ahead) {
				parts.push(`↑${ref.ahead}`);
			}
			if (ref.behind) {
				parts.push(`↓${ref.behind}`);
			}
		}
		return parts.join(' ');
	}

	private tooltip(ref: RawRef, active: boolean, fav: boolean): vscode.MarkdownString {
		const rows: Array<[string, string]> = [];
		if (active) {
			rows.push(['State', 'Current branch (HEAD)']);
		} else if (fav) {
			rows.push(['State', 'Favorite']);
		}
		if (ref.objectname) {
			rows.push([ref.isTag ? 'Tag' : 'Commit', ref.objectname]);
		}
		if (ref.upstream) {
			const track: string[] = [];
			if (ref.ahead) {
				track.push(`ahead ${ref.ahead}`);
			}
			if (ref.behind) {
				track.push(`behind ${ref.behind}`);
			}
			rows.push(['Upstream', `${ref.upstream}${track.length ? ` (${track.join(', ')})` : ''}`]);
		}
		return mdTooltip(rows, { title: ref.shortName });
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

/** vscode.git Ref → RawRef 归一（API 路径；head/ahead/behind 留空，由 isActive / 无 track 兜底）。 */
function refToRaw(r: Ref): RawRef {
	return {
		refname: r.name ?? '',
		shortName: r.name ?? '',
		objectname: r.commit?.slice(0, 7) ?? '',
		upstream: undefined,
		ahead: undefined,
		behind: undefined,
		head: false,
		isRemote: r.type === 1,
		isTag: r.type === 2,
	};
}
