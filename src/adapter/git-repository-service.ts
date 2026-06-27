import * as path from 'path';
import * as vscode from 'vscode';
import type { API, Repository } from '../types/git';
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

	/** 选取活跃仓库：优先匹配工作区根，否则首个。 */
	private pickRepository(): void {
		const folders = vscode.workspace.workspaceFolders;
		let repo: Repository | null = null;
		if (folders && folders.length > 0) {
			const wsRoot = folders[0].uri.fsPath;
			repo = this.api.repositories.find((r) => wsRoot.startsWith(r.rootUri.fsPath)) ?? null;
		}
		if (!repo) {
			repo = this.api.repositories[0] ?? null;
		}
		const changed = repo !== this._repo;
		if (changed) {
			this._repo = repo;
			if (repo) {
				this.disposables.push(repo.state.onDidChange(() => this._onDidChange.fire()));
			}
		}
		this._onDidChange.fire();
	}

	/** 读取本地变更（工作区 + 未跟踪），映射为 ChangeItem。 */
	getChanges(): ChangeItem[] {
		const repo = this._repo;
		if (!repo) {
			return [];
		}
		const root = repo.rootUri.fsPath;
		const items: ChangeItem[] = [];
		const fromChange = (uri: vscode.Uri, originalUri: vscode.Uri, renameUri: vscode.Uri | undefined, status: number, staged: boolean): ChangeItem => {
			const rel = path.relative(root, uri.fsPath).split(path.sep).join('/');
			return { relativePath: rel, uri, originalUri, renameUri, status: mapGitStatus(status), staged };
		};
		for (const c of repo.state.workingTreeChanges) {
			items.push(fromChange(c.uri, c.originalUri, c.renameUri ?? undefined, c.status, false));
		}
		for (const c of repo.state.untrackedChanges) {
			items.push(fromChange(c.uri, c.originalUri, c.renameUri ?? undefined, c.status, false));
		}
		return items;
	}

	/** 构造任意 ref 版本的资源 Uri（diff 原始端，复用 vscode.git 的 git scheme）。 */
	toGitUri(uri: vscode.Uri, ref: string): vscode.Uri {
		return this.api.toGitUri(uri, ref);
	}

	dispose(): void {
		this.disposables.forEach((d) => d.dispose());
		this._onDidChange.dispose();
	}
}
