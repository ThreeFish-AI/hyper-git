import * as vscode from 'vscode';
import type { Ref } from '../../types/git';
import type { GitRepositoryService } from '../git-repository-service';
import type { BranchFavorites } from '../branch-favorites';
import { FOR_EACH_REF_FORMAT, type RawRef, parseForEachRef } from '../../engine/ref/for-each-ref';
import { buildRefTree, type RefTreeNode } from '../../engine/ref/ref-tree';
import { mdTooltip } from './tree-tooltip';

export type BranchGroupId = 'favorites' | 'local' | 'remote' | 'tags';

export interface BranchGroupNode {
	readonly kind: 'group';
	readonly id: BranchGroupId;
	readonly label: string;
	/** 分组内条目数（标题栏描述显示计数徽标）。 */
	readonly count: number;
}

/** 前缀分组文件夹节点（如 `bak` / `origin` / compact 折叠的 `myorg/repo`）。无右键命令。 */
export interface BranchFolderNode {
	readonly kind: 'folder';
	/** 所属分段（local/remote/tags），用于 TreeItem.id 归属隔离。 */
	readonly group: BranchGroupId;
	/** 展示段（compact 折叠时形如 `a/b`）。 */
	readonly label: string;
	/** 完整前缀路径（展开/折叠稳定 key）。 */
	readonly path: string;
	/** 其下叶子总数。 */
	readonly count: number;
	readonly children: readonly BranchNode[];
}

export interface BranchRefNode {
	readonly kind: 'branch';
	readonly ref: RawRef;
	readonly remote: boolean;
	/** 分组形态下的展示后缀（末段）；平铺/收藏时省略，回退 `ref.shortName`。 */
	readonly label?: string;
}

export type BranchNode = BranchGroupNode | BranchFolderNode | BranchRefNode;

/** 远程符号引用 `refs/remotes/<remote>/HEAD`（短名如 `origin`）：非真实分支，视图统一隐藏，
 * 且规避「`origin` 叶子」与分组后「`origin` 文件夹」同名冲突。对 CLI（短名 `origin`）与
 * API（可能为 `origin/HEAD`）两种形态均鲁棒。 */
function isRemoteHead(r: RawRef): boolean {
	return r.isRemote && (!r.shortName.includes('/') || r.shortName.endsWith('/HEAD') || r.refname.endsWith('/HEAD'));
}

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
	private readonly groupingKey: string;
	/** 「按前缀分组为文件夹树」开关（工具栏切换、按仓库持久化，默认开启）。 */
	private groupingEnabled: boolean;

	constructor(
		private readonly service: GitRepositoryService,
		private readonly favorites: BranchFavorites,
		private readonly workspaceState: vscode.Memento,
		repoRoot: string,
	) {
		this.groupingKey = `hyperGit.branchesGrouping:${repoRoot}`;
		this.groupingEnabled = this.workspaceState.get<boolean>(this.groupingKey) ?? true;
		this.disposables.push(service.onDidChange(() => this.refresh()));
		this.disposables.push(favorites.onDidChange(() => this.refresh()));
	}

	refresh(): void {
		this.refsCache = undefined;
		this._onDidChange.fire(undefined);
	}

	/** 当前是否按前缀分组（供 extension 初始化 setContext）。 */
	get grouping(): boolean {
		return this.groupingEnabled;
	}

	/** 切换分组形态：持久化（按仓库）并刷新视图；no-op 时不刷新。 */
	setGrouping(value: boolean): void {
		if (this.groupingEnabled === value) {
			return;
		}
		this.groupingEnabled = value;
		void this.workspaceState.update(this.groupingKey, value);
		this.refresh();
	}

	async getChildren(element?: BranchNode): Promise<BranchNode[]> {
		const repo = this.service.repo;
		if (!repo) {
			return [];
		}
		if (element?.kind === 'folder') {
			return [...element.children];
		}
		// displayRefs：隐藏远程 HEAD 符号引用（origin/HEAD），供计数 / 收藏 / 分组一致取用。
		const refs = (await this.loadRefs()).filter((r) => !isRemoteHead(r));
		if (!element) {
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
			switch (element.id) {
				case 'favorites':
					// 收藏为精选小列表，恒平铺并显示完整短名，便于辨识 `bak/2025` vs `2025`。
					return this.favoriteNodes(refs);
				case 'local':
					return this.sectionNodes(
						refs.filter((r) => !r.isRemote && !r.isTag),
						'local',
					);
				case 'remote':
					return this.sectionNodes(
						refs.filter((r) => r.isRemote),
						'remote',
					);
				case 'tags':
					return this.sectionNodes(
						refs.filter((r) => r.isTag),
						'tags',
					);
			}
		}
		return [];
	}

	/**
	 * 生成某分段（local/remote/tags）的子节点：分组开启则按 `/` 前缀构建文件夹树（{@link buildRefTree}），
	 * 关闭则回退平铺（local 用 active→fav→字母序，remote/tags 字母序，保持既有行为）。
	 */
	private sectionNodes(refs: RawRef[], group: BranchGroupId): BranchNode[] {
		if (this.groupingEnabled) {
			const tree = buildRefTree(refs, {
				compactFolders: true,
				isActive: (r) => this.isActive(r),
				isFavorite: (r) => this.favorites.isFavorite(r.shortName),
			});
			return this.toBranchNodes(tree, group);
		}
		const flat =
			group === 'local' ? this.sortLocal(refs) : [...refs].sort((a, b) => a.shortName.localeCompare(b.shortName));
		return flat.map((r) => this.toNode(r));
	}

	/** 递归把引擎 {@link RefTreeNode} 映射为适配层 BranchNode（叶携 ref + 后缀 label，文件夹携 group）。 */
	private toBranchNodes(nodes: readonly RefTreeNode[], group: BranchGroupId): BranchNode[] {
		return nodes.map((n) =>
			n.kind === 'leaf'
				? { kind: 'branch', ref: n.ref, remote: n.ref.isRemote, label: n.label }
				: {
					kind: 'folder',
					group,
					label: n.label,
					path: n.path,
					count: n.count,
					children: this.toBranchNodes(n.children, group),
				},
		);
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
				element.id === 'remote'
					? 'repo'
					: element.id === 'tags'
						? 'tag'
						: element.id === 'favorites'
							? 'star-full'
							: 'git-branch';
			item.iconPath = new vscode.ThemeIcon(icon);
			return item;
		}
		if (element.kind === 'folder') {
			// 前缀文件夹：默认展开（对齐图2）；id 按分段+前缀隔离，令展开态跨 refresh 稳定。
			const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
			item.id = `folder:${element.group}:${element.path}`;
			item.contextValue = 'hyperGit.branchFolder';
			item.iconPath = new vscode.ThemeIcon('folder');
			return item;
		}
		const ref = element.ref;
		const active = this.isActive(ref);
		const fav = this.favorites.isFavorite(ref.shortName);
		const isTag = ref.isTag;
		// 分组形态下展示后缀（element.label）；平铺/收藏回退完整短名。命令仍以 ref.shortName 定位。
		const item = new vscode.TreeItem(element.label ?? ref.shortName, vscode.TreeItemCollapsibleState.None);
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
