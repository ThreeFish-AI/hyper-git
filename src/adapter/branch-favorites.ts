import * as vscode from 'vscode';
import { toggleFavorite } from '../engine/ref/favorites';

/**
 * BranchFavorites：分支收藏持久化（仿 {@link ChangelistRegistry}）。
 *
 * 分支收藏（Set Favorite）能力：把常用分支标星置顶。收藏名列表存于 workspaceState（按仓库根隔离），
 * 重启后恢复。集合运算复用纯逻辑 {@link toggleFavorite}，便于单测。
 */
export class BranchFavorites implements vscode.Disposable {
	private names: string[];
	private storageKey: string;
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange: vscode.Event<void> = this._onDidChange.event;

	constructor(private readonly workspaceState: vscode.Memento, repoRoot: string) {
		this.storageKey = `hyperGit.branchFavorites:${repoRoot}`;
		this.names = this.load();
	}

	/** 多根仓库切换 rebind（issue #107）：换 storageKey 重载该仓库的收藏，幂等，切换后 fire 刷新。 */
	setRepoRoot(repoRoot: string): void {
		const key = `hyperGit.branchFavorites:${repoRoot}`;
		if (key === this.storageKey) {
			return;
		}
		this.storageKey = key;
		this.names = this.load();
		this._onDidChange.fire();
	}

	private load(): string[] {
		const raw = this.workspaceState.get<string>(this.storageKey);
		if (!raw) {
			return [];
		}
		try {
			const arr = JSON.parse(raw) as unknown;
			return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
		} catch {
			return [];
		}
	}

	private persist(): void {
		void this.workspaceState.update(this.storageKey, JSON.stringify(this.names));
		this._onDidChange.fire();
	}

	/** 收藏名列表（插入顺序）。 */
	list(): readonly string[] {
		return this.names;
	}

	isFavorite(name: string): boolean {
		return this.names.includes(name);
	}

	/** 切换某分支（按 shortName）的收藏态。 */
	toggle(name: string): void {
		this.names = toggleFavorite(this.names, name);
		this.persist();
	}

	dispose(): void {
		this._onDidChange.dispose();
	}
}
