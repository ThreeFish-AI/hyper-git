/*---------------------------------------------------------------------------------------------*
 * VS Code 内置 git 扩展导出 API 的类型契约（消费侧）。
 * 改编自 microsoft/vscode extensions/git/src/api/git.d.ts（MIT License）。
 *
 * 调整说明（相对官方原文件）：
 *  - 将 `const enum`（Status / RefType / ForcePushMode / GitErrorCodes）改为 `number`，
 *    以规避 esbuild 打包时 `.d.ts` 中 const enum 无法在运行时取值的问题；
 *    Status 数值语义见 src/adapter/git-status-map.ts 的 GitStatus 镜像（单一事实源）。
 *  - 裁剪 M1-M5 不直接消费的 provider 注册接口，保留 Repository 全量方法以利后续里程碑。
 *--------------------------------------------------------------------------------------------*/

import { Uri, Event, CancellationToken } from 'vscode';

export interface Git {
	readonly path: string;
}
export interface InputBox {
	value: string;
}

export type RefType = number; // 0=Head, 1=RemoteHead, 2=Tag
export type ForcePushMode = number; // 0=Force, 1=ForceWithLease, 2=ForceWithLeaseIfIncludes

export interface Ref {
	readonly type: RefType;
	readonly name?: string;
	readonly commit?: string;
	readonly remote?: string;
}
export interface UpstreamRef {
	readonly remote: string;
	readonly name: string;
	readonly commit?: string;
}
export interface Branch extends Ref {
	readonly upstream?: UpstreamRef;
	readonly ahead?: number;
	readonly behind?: number;
}
export interface CommitShortStat {
	readonly files: number;
	readonly insertions: number;
	readonly deletions: number;
}
export interface Commit {
	readonly hash: string;
	readonly message: string;
	readonly parents: string[];
	readonly authorDate?: Date;
	readonly authorName?: string;
	readonly authorEmail?: string;
	readonly commitDate?: Date;
	readonly shortStat?: CommitShortStat;
}
export interface Submodule {
	readonly name: string;
	readonly path: string;
	readonly url: string;
}
export interface Remote {
	readonly name: string;
	readonly fetchUrl?: string;
	readonly pushUrl?: string;
	readonly isReadOnly: boolean;
}
export interface Worktree {
	readonly name: string;
	readonly path: string;
	readonly ref: string;
	readonly main: boolean;
	readonly detached: boolean;
}

export interface Change {
	/** 优先使用：rename 时为 renameUri，否则 originalUri。 */
	readonly uri: Uri;
	readonly originalUri: Uri;
	readonly renameUri: Uri | undefined;
	/** 变更状态（数值），语义见 src/adapter/git-status-map.ts 的 GitStatus 镜像。 */
	readonly status: number;
}
export interface DiffChange extends Change {
	readonly insertions: number;
	readonly deletions: number;
}

export type RepositoryKind = 'repository' | 'submodule' | 'worktree';

export interface RepositoryState {
	readonly HEAD: Branch | undefined;
	readonly refs: Ref[];
	readonly remotes: Remote[];
	readonly submodules: Submodule[];
	readonly worktrees: Worktree[];
	readonly rebaseCommit: Commit | undefined;

	readonly mergeChanges: Change[];
	readonly indexChanges: Change[];
	readonly workingTreeChanges: Change[];
	readonly untrackedChanges: Change[];

	readonly onDidChange: Event<void>;
}
export interface RepositoryUIState {
	readonly selected: boolean;
	readonly onDidChange: Event<void>;
}

export interface LogOptions {
	readonly maxEntries?: number;
	readonly path?: string;
	readonly range?: string;
	readonly reverse?: boolean;
	readonly sortByAuthorDate?: boolean;
	readonly shortStats?: boolean;
	readonly author?: string;
	readonly grep?: string;
	readonly refNames?: string[];
	readonly maxParents?: number;
	readonly skip?: number;
}
export interface CommitOptions {
	all?: boolean | 'tracked';
	amend?: boolean;
	signoff?: boolean;
	signCommit?: boolean;
	empty?: boolean;
	noVerify?: boolean;
	requireUserConfig?: boolean;
	useEditor?: boolean;
	verbose?: boolean;
	postCommitCommand?: string | null;
}
export interface FetchOptions {
	remote?: string;
	ref?: string;
	all?: boolean;
	prune?: boolean;
	depth?: number;
}
export interface InitOptions {
	defaultBranch?: string;
}
export interface RefQuery {
	readonly contains?: string;
	readonly count?: number;
	readonly pattern?: string | string[];
	readonly sort?: 'alphabetically' | 'committerdate' | 'creatordate';
}
export interface BranchQuery extends RefQuery {
	readonly remote?: boolean;
}

export interface Repository {
	readonly rootUri: Uri;
	readonly inputBox: InputBox;
	readonly state: RepositoryState;
	readonly ui: RepositoryUIState;
	readonly kind: RepositoryKind;
	readonly isUsingVirtualFileSystem: boolean;

	readonly onDidCommit: Event<void>;
	readonly onDidCheckout: Event<void>;

	getConfigs(): Promise<{ key: string; value: string; }[]>;
	getConfig(key: string): Promise<string>;
	setConfig(key: string, value: string): Promise<string>;
	unsetConfig(key: string): Promise<string>;
	getGlobalConfig(key: string): Promise<string>;

	add(paths: string[]): Promise<void>;
	revert(paths: string[]): Promise<void>;
	clean(paths: string[]): Promise<void>;
	restore(paths: string[], options?: { staged?: boolean; ref?: string }): Promise<void>;

	diffWithHEAD(): Promise<Change[]>;
	diffWithHEAD(path: string): Promise<string>;
	diffWith(ref: string): Promise<Change[]>;
	diffWith(ref: string, path: string): Promise<string>;
	diffIndexWithHEAD(): Promise<Change[]>;
	diffIndexWithHEAD(path: string): Promise<string>;

	createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
	deleteBranch(name: string, force?: boolean): Promise<void>;
	getBranch(name: string): Promise<Branch>;
	getBranches(query: BranchQuery, cancellationToken?: CancellationToken): Promise<Ref[]>;
	setBranchUpstream(name: string, upstream: string): Promise<void>;

	status(): Promise<void>;
	checkout(treeish: string): Promise<void>;

	fetch(options?: FetchOptions): Promise<void>;
	fetch(remote?: string, ref?: string, depth?: number): Promise<void>;
	pull(unshallow?: boolean): Promise<void>;
	push(remoteName?: string, branchName?: string, setUpstream?: boolean, force?: ForcePushMode): Promise<void>;

	blame(path: string): Promise<string>;
	log(options?: LogOptions): Promise<Commit[]>;

	commit(message: string, opts?: CommitOptions): Promise<void>;
	merge(ref: string): Promise<void>;
	mergeAbort(): Promise<void>;
	rebase(branch: string): Promise<void>;

	createStash(options?: { message?: string; includeUntracked?: boolean; staged?: boolean }): Promise<void>;
	applyStash(index?: number): Promise<void>;
	popStash(index?: number): Promise<void>;
	dropStash(index?: number): Promise<void>;
}

export type APIState = 'uninitialized' | 'initialized';
export interface PublishEvent {
	repository: Repository;
	branch?: string;
}

export interface API {
	readonly state: APIState;
	readonly onDidChangeState: Event<APIState>;
	readonly onDidPublish: Event<PublishEvent>;
	readonly git: Git;
	readonly repositories: Repository[];
	readonly onDidOpenRepository: Event<Repository>;
	readonly onDidCloseRepository: Event<Repository>;

	toGitUri(uri: Uri, ref: string): Uri;
	getRepository(uri: Uri): Repository | null;
	getRepositoryRoot(uri: Uri): Promise<Uri | null>;
	init(root: Uri, options?: InitOptions): Promise<Repository | null>;
	openRepository(root: Uri): Promise<Repository | null>;
}

export interface GitExtension {
	readonly enabled: boolean;
	readonly onDidChangeEnablement: Event<boolean>;
	getAPI(version: 1): API;
}
