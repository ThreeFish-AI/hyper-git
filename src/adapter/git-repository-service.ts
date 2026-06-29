import { execFile } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { logGit } from '../infra/git-console';
import type { API, Change, Repository } from '../types/git';
import { FileStatus } from '../engine/model';
import { mapGitStatus } from './git-status-map';

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
 */
export class GitRepositoryService implements vscode.Disposable {
	private _repo: Repository | null = null;
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange: vscode.Event<void> = this._onDidChange.event;
	private readonly disposables: vscode.Disposable[] = [];
	private repoSub?: vscode.Disposable;

	constructor(private readonly api: API) {
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

	/** 选取活跃仓库：优先匹配工作区根（用 API.getRepository，路径段精确匹配），否则首个。 */
	private pickRepository(): void {
		let repo: Repository | null = null;
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (folder) {
			repo = this.api.getRepository(folder.uri) ?? null;
		}
		if (!repo) {
			repo = this.api.repositories[0] ?? null;
		}
		if (repo !== this._repo) {
			this.repoSub?.dispose();
			this.repoSub = undefined;
			this._repo = repo;
			if (repo) {
				this.repoSub = repo.state.onDidChange(() => this._onDidChange.fire());
			}
			this._onDidChange.fire();
		}
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
			const rel = path.relative(root, c.uri.fsPath).split(path.sep).join('/');
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
	}
}
