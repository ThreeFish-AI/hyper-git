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
 * - {@link isRemoteRefMissingError}：识别「服务端已无此 ref」的 push 失败（本地 tracking ref 陈旧场景）。
 * - {@link formatRemoteDeleteResult}：把逐分支删除结果三桶汇总为通知文案与级别。
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
	const head = opts?.hasUpstreamOfHead ? '⚠ The selection includes the upstream of the current branch; deleting it will leave the current branch untracked.\n' : '';
	const irreversible = 'This acts on the remote repository, cannot be undone, and may affect other collaborators.';
	const n = deletable.length;
	const body =
		n === 1
			? `Delete remote branch "${deletable[0].shortName}" (on remote ${deletable[0].remote})?\n${irreversible}`
			: `Delete ${n} remote branches: ${truncateNames(deletable.map((t) => t.shortName))}.\n${irreversible}`;
	return { detail: `${head}${body}`, confirmLabel: 'Delete' };
}

/** 单条远程删除失败：分支短名 + 从 stderr/message 提取的原因。 */
export interface RemoteDeleteFailure {
	/** 远程分支短名，如 origin/foo。 */
	readonly name: string;
	/** 失败原因（stderr 优先），可能多行。 */
	readonly reason: string;
}

/** 「服务端已无此 ref」的报错文案（大小写不敏感）。git 2.x 规范文案 + 旧服务端变体。 */
const REMOTE_REF_MISSING_PATTERNS: readonly RegExp[] = [/remote ref does not exist/i, /delete of non-existent ref/i];

/**
 * 判定 `git push <remote> --delete <branch>` 的失败是否属「服务端已无此 ref」。
 *
 * 典型场景：PR 合并后远端自动删除分支，本地 remote-tracking ref 在下一次 `fetch --prune`
 * 前一直陈旧——视图仍列出它，push --delete 却被服务端拒绝
 * （`error: unable to delete 'x': remote ref does not exist`）。此分支的目标态（服务端无此分支）
 * 已天然达成，应按成功收尾并清理本地陈旧 ref，而非误报失败。
 *
 * @param e execGit 的拒绝值：stderr 已透传挂载（优先），无 stderr 时回退 message。
 */
export function isRemoteRefMissingError(e: unknown): boolean {
	let text = '';
	if (e && typeof e === 'object') {
		const ge = e as { stderr?: unknown; message?: unknown };
		if (typeof ge.stderr === 'string') {
			text = ge.stderr;
		} else if (typeof ge.message === 'string') {
			text = ge.message;
		}
	}
	return text.length > 0 && REMOTE_REF_MISSING_PATTERNS.some((re) => re.test(text));
}

/** 失败原因折叠为单行（换行→'; '），并截断总长，避免通知气泡过长。 */
function collapseReason(reason: string, max = 160): string {
	const line = reason.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join('; ');
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** 通知级别：仅成功/已不存在走 info；存在真失败走 error（联动 Show Output）。 */
export type RemoteDeleteResultLevel = 'info' | 'error';

/**
 * 把逐分支远程删除结果（成功 / 服务端已不存在 / 失败）三桶汇总为通知文案与级别（纯逻辑）。
 *
 * 诚实计数：alreadyGone 单列（服务端本就无此分支，非本次删除），失败项附真实原因。
 * @param succeeded 服务端删除成功的目标
 * @param alreadyGone 服务端已无此分支、按达成处理的目标（本地陈旧 tracking ref 已一并清理）
 * @param failures 真失败项（含原因），展示超 4 条截断标注
 */
export function formatRemoteDeleteResult(
	succeeded: readonly RemoteBranchTarget[],
	alreadyGone: readonly RemoteBranchTarget[],
	failures: readonly RemoteDeleteFailure[],
): { level: RemoteDeleteResultLevel; message: string } {
	const deletedPart = succeeded.length === 1 ? `Deleted remote branch ${succeeded[0].shortName}` : `Deleted ${succeeded.length} remote branches`;
	const gonePart = alreadyGone.length > 0 ? `; ${alreadyGone.length} already gone on remote (pruned local tracking ref${alreadyGone.length > 1 ? 's' : ''})` : '';
	if (failures.length === 0) {
		return { level: 'info', message: `${deletedPart}${gonePart}` };
	}
	const MAX_SHOWN = 4;
	const shown = failures.slice(0, MAX_SHOWN).map((f) => `${f.name} (${collapseReason(f.reason)})`);
	const more = failures.length > MAX_SHOWN ? ` … and ${failures.length - MAX_SHOWN} more` : '';
	return { level: 'error', message: `${deletedPart}${gonePart}; ${failures.length} failed: ${shown.join(', ')}${more}` };
}
