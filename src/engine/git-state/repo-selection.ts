/**
 * 活跃仓库选取纯逻辑（issue #107 多根工作区仓库切换）。
 *
 * 选取优先级：
 * 1. 持久化的上次活跃仓库（用户显式选择或 last-active 留痕）仍存在 → 恢复；
 * 2. 首个工作区文件夹命中的仓库（folder 为 git root 或位于某 repo 内）；
 * 3. 首个已发现仓库（与旧版 pickRepository 的回退一致）；
 * 4. 无仓库 → null。
 *
 * 零 vscode 依赖，路径归一化（去尾分隔符 + win32 大小写不敏感）保证跨平台稳定比较。
 */

/** 仓库最小投影（adapter 侧由 vscode.git Repository 投影而来）。 */
export interface RepoLike {
	readonly rootPath: string;
}

/** pickRepositoryRoot 输入（repoForFolder 可注入 vscode.git 的 getRepository 语义）。 */
export interface PickRepoInput<R extends RepoLike> {
	readonly repos: readonly R[];
	/** 首个工作区文件夹路径（workspaceFolders[0]），可能不是 git root。 */
	readonly firstWorkspaceFolder?: string;
	/** 持久化的上次活跃仓库根路径（workspaceState）。 */
	readonly persistedRoot?: string;
	/**
	 * 文件夹 → 仓库匹配器（注入 `api.getRepository(uri)` 语义：folder 为 git root 或处于 repo 内均命中）。
	 * 缺省用最长祖先路径匹配（单测与无 API 场景的等价实现）。
	 */
	readonly repoForFolder?: (folderPath: string) => R | undefined;
}

/** 路径归一化：去尾分隔符；win32 盘符大小写不敏感 → 统一小写比较。 */
export function normalizeRoot(p: string): string {
	const trimmed = p.endsWith('/') || p.endsWith('\\') ? p.slice(0, -1) : p;
	return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

/** 最长祖先路径匹配：返回 repos 中 rootPath 为 folder 祖先（或相等）的最深仓库。 */
function matchByAncestor<R extends RepoLike>(repos: readonly R[], folder: string): R | undefined {
	const nFolder = normalizeRoot(folder);
	let best: R | undefined;
	let bestLen = -1;
	for (const repo of repos) {
		const nRoot = normalizeRoot(repo.rootPath);
		const isAncestor = nFolder === nRoot || nFolder.startsWith(nRoot + '/') || nFolder.startsWith(nRoot + '\\');
		if (isAncestor && nRoot.length > bestLen) {
			best = repo;
			bestLen = nRoot.length;
		}
	}
	return best;
}

/** 依优先级选取活跃仓库（引用稳定：命中即原样返回 repos 中的元素）。 */
export function pickRepositoryRoot<R extends RepoLike>(input: PickRepoInput<R>): R | null {
	const { repos, firstWorkspaceFolder, persistedRoot, repoForFolder } = input;
	// 1. 持久化恢复：上次活跃仓库仍存在于已发现列表（避免 VS Code 发现顺序不稳定导致的漂移）。
	if (persistedRoot) {
		const nPersisted = normalizeRoot(persistedRoot);
		const hit = repos.find((r) => normalizeRoot(r.rootPath) === nPersisted);
		if (hit) {
			return hit;
		}
	}
	// 2. 首个工作区文件夹命中的仓库（注入匹配器优先，缺省最长祖先匹配）。
	if (firstWorkspaceFolder) {
		const hit = repoForFolder?.(firstWorkspaceFolder) ?? matchByAncestor(repos, firstWorkspaceFolder);
		if (hit) {
			return hit;
		}
	}
	// 3. 回退：首个已发现仓库（保持与旧版行为兼容）。
	return repos[0] ?? null;
}
