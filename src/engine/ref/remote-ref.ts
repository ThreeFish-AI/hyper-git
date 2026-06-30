/**
 * 远程分支删除的纯逻辑（零 vscode 依赖）。
 *
 * 远程分支删除是 `git push <remote> --delete <branch>`，与本地 `git branch -d/-D`（见 cleanup.ts）
 * 正交：作用于远程服务器、影响协作者、不可撤销（无本地 reflog 兜底）。本模块提供其特有的：
 * - {@link resolveRemoteBranch}：把 `origin/feature/foo` 这类远程短名拆成 {remote, branch}。
 *   必须用「已知 remotes 列表」做最长前缀匹配——remote 名本身可含 `/`（如 fork 场景 `myorg/repo`），
 *   朴素 `split('/')[0]` 会把 `myorg/repo/feature` 错切成 `myorg`。
 * - {@link partitionRemoteByProtected}：复用 {@link isProtectedBranch}，把 main/master 等主干硬排除。
 * - {@link formatRemoteDeleteConfirm}：生成 modal 确认文案，诚实传达服务器端不可逆 + 协作者影响。
 *
 * 与 cleanup.ts 的关系：复用其 `isProtectedBranch` / `truncateNames` 作为单一事实源（轻量指针，不复制定义）。
 */

import { isProtectedBranch, truncateNames } from './cleanup';

/** 解析后的远程分支定位。 */
export interface RemoteBranchTarget {
	/** 远程名，如 origin / upstream / myorg/repo。 */
	readonly remote: string;
	/** 远程上的分支名（不含 remote 前缀），如 feature/foo。 */
	readonly branch: string;
	/** 规范化短名 remote/branch，用于回显。 */
	readonly shortName: string;
}

/**
 * 用「已知 remotes 列表」做最长前缀匹配，把远程短名拆成 {remote, branch}。
 *
 * 为何不用 `shortName.split('/')[0]`：remote 名可含 `/`（GitHub fork/子组场景 `myorg/repo`），
 * 其分支 `myorg/repo/feature` 的正确切分是 `remote='myorg/repo'`、`branch='feature'`；
 * 朴素首段切分会得到 `'myorg'` → 推到不存在的 remote 失败，甚至误删。
 *
 * @param shortName 远程分支短名，如 `origin/feature/foo`
 * @param remotes 仓库已配置的 remote 名列表（权威事实源，来自 `repo.state.remotes`）
 * @returns 匹配成功返回定位；shortName 是纯 remote 名 / 不属任何已知 remote / 分支段为空 时返回 null
 */
export function resolveRemoteBranch(shortName: string, remotes: readonly string[]): RemoteBranchTarget | null {
	// 按长度降序保证最长前缀优先（`myorg/repo` 优先于 `myorg`）。
	for (const remote of [...remotes].sort((a, b) => b.length - a.length)) {
		if (shortName === remote) {
			// 纯 remote 名本身，无分支段。
			return null;
		}
		const prefix = `${remote}/`;
		// 必须带 '/' 分隔符，避免 `origin` 误匹配 `originx/...`。
		if (shortName.startsWith(prefix)) {
			const branch = shortName.slice(prefix.length);
			if (branch) {
				return { remote, branch, shortName };
			}
		}
	}
	return null;
}

/**
 * 把选中的远程分支按「可删 / 受保护」分桶。
 *
 * 复用 {@link isProtectedBranch}（SSOT）：main/master 等主干一旦在远程删除会摧毁团队共享主干
 * 并阻断所有协作者的下一次 push，属比「删未合并本地分支」严重一个数量级的灾难，故硬排除。
 */
export function partitionRemoteByProtected(
	targets: readonly RemoteBranchTarget[],
): { deletable: RemoteBranchTarget[]; protectedTargets: RemoteBranchTarget[] } {
	const deletable: RemoteBranchTarget[] = [];
	const protectedTargets: RemoteBranchTarget[] = [];
	for (const t of targets) {
		(isProtectedBranch(t.branch) ? protectedTargets : deletable).push(t);
	}
	return { deletable, protectedTargets };
}

/**
 * 生成远程删除的 modal 确认文案与确认按钮文本（纯逻辑）。
 *
 * 远程删除的风险语义与本地本质不同：作用于服务器、影响协作者、不可撤销（无本地 reflog 兜底），
 * 且 `git push --delete` 无 -d/-D 区分（远端无条件删除）。文案须诚实传达这三点；
 * 按钮统一为「删除」（区别本地「删除/强制删除/全部删除」三态）。
 *
 * @param deletable 经 {@link partitionRemoteByProtected} 过滤后的可删目标
 * @param opts.hasUpstreamOfHead 待删集合是否包含当前分支的上游（软警示，不硬阻断——本地分支与提交仍在，仅失远程追踪）
 */
export function formatRemoteDeleteConfirm(
	deletable: readonly RemoteBranchTarget[],
	opts?: { hasUpstreamOfHead?: boolean },
): { detail: string; confirmLabel: string } {
	const head = opts?.hasUpstreamOfHead ? '⚠ 其中包含当前分支的上游，删除后当前分支将失去远程追踪。\n' : '';
	const irreversible = '此操作作用于远程仓库，不可撤销，并可能影响其他协作者。';
	const n = deletable.length;
	const body =
		n === 1
			? `将删除远程分支「${deletable[0].shortName}」（位于远程 ${deletable[0].remote}）。\n${irreversible}`
			: `将删除 ${n} 个远程分支：${truncateNames(deletable.map((t) => t.shortName))}。\n${irreversible}`;
	return { detail: `${head}${body}`, confirmLabel: '删除' };
}
