import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { logGit } from '../infra/git-console';
import type { API, Change, Repository } from '../types/git';
import { FileStatus } from '../engine/model';
import { countUniqueChanges, toRelKey } from '../engine/scm-mapping/change-count';
import { normalizeRoot, pickRepositoryRoot } from '../engine/git-state/repo-selection';
import { mapGitStatus } from './git-status-map';

/** workspaceState 持久化键：上次活跃仓库根路径（per-workspace 天然隔离）。 */
const ACTIVE_REPO_KEY = 'hyperGit.activeRepoRoot';

/** 活跃仓库切换事件载荷。 */
export interface ActiveRepositoryChange {
	/** 切换前的仓库根（null = 此前无仓库）。 */
	readonly previousRoot: string | null;
	/** 切换后的仓库根（null = 全部仓库已关闭）。 */
	readonly root: string | null;
}

/** 适配层视图模型：一个文件的变更（携带 vscode.Uri 供 diff/操作）。 */
export interface ChangeItem {
	/** 仓库相对路径（posix 分隔），用作 changelist 分组稳定 key。 */
	readonly relativePath: string;
	readonly uri: vscode.Uri;
	readonly originalUri: vscode.Uri;
	readonly renameUri?: vscode.Uri;
	readonly status: FileStatus;
	readonly staged: boolean;
}

/**
 * GitRepositoryService：封装 vscode.git 的活跃 Repository。
 * 职责：选取活跃仓库、读取变更（→ ChangeItem）、暴露状态变更事件、提供 diff/写操作委托。
 *
 * 多根工作区（issue #107）：活跃仓库可经 {@link selectRepository} 手动切换并持久化
 * （`hyperGit.activeRepoRoot`，"last active" 语义）。**契约：任何构造期快照 repoRoot 的组件
 * 必须订阅 {@link onDidChangeRepository} 重绑**——该事件先于 onDidChange fire（同步完成
 * rebind，之后防抖刷新才重取数据）。
 */
export class GitRepositoryService implements vscode.Disposable {
	private _repo: Repository | null = null;
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange: vscode.Event<void> = this._onDidChange.event;
	private readonly _onDidChangeRepository = new vscode.EventEmitter<ActiveRepositoryChange>();
	/** 活跃仓库切换（打开/关闭/手动选择/持久化恢复）。rebind 订阅必须先于 onDidChange 消费注册。 */
	readonly onDidChangeRepository: vscode.Event<ActiveRepositoryChange> = this._onDidChangeRepository.event;
	private readonly disposables: vscode.Disposable[] = [];
	private repoSub?: vscode.Disposable;

	constructor(
		private readonly api: API,
		private readonly workspaceState: vscode.Memento,
	) {
		this.disposables.push(api.onDidOpenRepository(() => this.pickRepository()));
		this.disposables.push(api.onDidCloseRepository(() => this.pickRepository()));
		this.pickRepository();
	}

	get repo(): Repository | null {
		return this._repo;
	}

	get repoRoot(): string | null {
		return this._repo?.rootUri.fsPath ?? null;
	}

	/**
	 * 选取活跃仓库（引擎三级优先级：持久化恢复 → 首个 folder 匹配 → 首个仓库），
	 * 任何来源的成功选取都写回持久化（"last active" 留痕，重开窗口回到上次操作的仓库）。
	 * repoForFolder 注入：folder 为 git root 或 repo 内路径均命中（getRepository 同语义的
	 * rootPath 等价实现，直接持有 api 处无需额外间接层）。
	 */
	private pickRepository(): void {
		const folder = vscode.workspace.workspaceFolders?.[0];
		const picked = pickRepositoryRoot({
			repos: this.api.repositories.map((r) => ({ rootPath: r.rootUri.fsPath, repo: r })),
			firstWorkspaceFolder: folder?.uri.fsPath,
			persistedRoot: this.workspaceState.get<string>(ACTIVE_REPO_KEY),
		});
		this.applyRepository(picked?.repo ?? null);
		if (picked) {
			void this.workspaceState.update(ACTIVE_REPO_KEY, picked.rootPath);
		}
	}

	/** 应用活跃仓库：重订状态订阅并按序 fire（先切换事件同步 rebind，后变更事件驱动防抖刷新）。 */
	private applyRepository(repo: Repository | null): void {
		if (repo === this._repo) {
			return;
		}
		const previousRoot = this.repoRoot;
		this.repoSub?.dispose();
		this.repoSub = undefined;
		this._repo = repo;
		if (repo) {
			this.repoSub = repo.state.onDidChange(() => this._onDidChange.fire());
		}
		this._onDidChangeRepository.fire({ previousRoot, root: this.repoRoot });
		this._onDidChange.fire();
	}

	/** 手动切换活跃仓库（仓库选择器 / 命令接缝）。未命中返回 false；命中当前仓库返回 true（幂等）。 */
	selectRepository(root: string): boolean {
		const hit = this.api.repositories.find((r) => normalizeRoot(r.rootUri.fsPath) === normalizeRoot(root));
		if (!hit) {
			return false;
		}
		if (hit === this._repo) {
			return true;
		}
		this.applyRepository(hit);
		void this.workspaceState.update(ACTIVE_REPO_KEY, hit.rootUri.fsPath);
		return true;
	}

	/** 已发现仓库投影（QuickPick / webview 消费，不暴露内部 Repository）。 */
	listRepositories(): readonly { rootPath: string }[] {
		return this.api.repositories.map((r) => ({ rootPath: r.rootUri.fsPath }));
	}

	/** 读取本地变更（已暂存 + 工作区 + 未跟踪，按相对路径去重，index 优先），映射为 ChangeItem。 */
	getChanges(): ChangeItem[] {
		const repo = this._repo;
		if (!repo) {
			return [];
		}
		const root = repo.rootUri.fsPath;
		const map = new Map<string, ChangeItem>();
		const add = (c: Change, staged: boolean): void => {
			const rel = toRelKey(root, c.uri.fsPath);
			if (map.has(rel)) {
				return;
			}
			map.set(rel, {
				relativePath: rel,
				uri: c.uri,
				originalUri: c.originalUri,
				renameUri: c.renameUri ?? undefined,
				status: mapGitStatus(c.status),
				staged,
			});
		};
		for (const c of repo.state.indexChanges) {
			add(c, true);
		}
		for (const c of repo.state.workingTreeChanges) {
			add(c, false);
		}
		for (const c of repo.state.untrackedChanges) {
			add(c, false);
		}
		return [...map.values()];
	}

	/**
	 * 未提交变更计数（已暂存 + 工作区 + 未跟踪，按相对路径去重）。语义等同 `getChanges().length`，
	 * 但不构造 ChangeItem，供活动栏角标高频刷新走轻量路径（复用同一去重事实源）。
	 */
	getChangeCount(): number {
		const repo = this._repo;
		if (!repo) {
			return 0;
		}
		return countUniqueChanges(
			repo.rootUri.fsPath,
			repo.state.indexChanges,
			repo.state.workingTreeChanges,
			repo.state.untrackedChanges,
		);
	}

	/** 构造任意 ref 版本的资源 Uri（diff 原始端，复用 vscode.git 的 git scheme）。 */
	toGitUri(uri: vscode.Uri, ref: string): vscode.Uri {
		return this.api.toGitUri(uri, ref);
	}

	/**
	 * 受控 git CLI 通道：复用 vscode.git 的同一 git 二进制（`api.git.path`），补齐稳定 API 未暴露的操作
	 * （cherry-pick / revert / reset / branch rename / stash list / compare 等）。仓库根为工作目录。
	 * 仅作为 API 缺口的补充，不重造 vscode.git 已覆盖的能力。
	 */
	async execGit(args: string[], options?: { env?: NodeJS.ProcessEnv }): Promise<string> {
		const repo = this._repo;
		if (!repo) {
			throw new Error('未找到 Git 仓库');
		}
		return new Promise((resolve, reject) => {
			execFile(this.api.git.path, args, { cwd: repo.rootUri.fsPath, maxBuffer: 20 * 1024 * 1024, encoding: 'utf8', env: options?.env }, (err, stdout) => {
				if (err) {
					logGit(args, undefined, err.message);
					reject(err);
				} else {
					logGit(args, stdout);
					resolve(stdout);
				}
			});
		});
	}

	dispose(): void {
		this.repoSub?.dispose();
		this.disposables.forEach((d) => d.dispose());
		this._onDidChange.dispose();
		this._onDidChangeRepository.dispose();
	}
}
