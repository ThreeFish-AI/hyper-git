/**
 * 分支就地更新（不 checkout）的纯逻辑（零 vscode 依赖）。
 *
 * 核心原语：`git fetch <remote> refs/heads/<upstream>:refs/heads/<branch>`——git 原生 fast-forward-only，
 * diverged / ahead-only 时拒绝回退（`! [rejected] ... (non-fast-forward)`），永不改写本地提交；
 * 目标是当前分支（含被其他 worktree checkout）时 git 拒绝
 * （`refusing to fetch into branch '…' checked out at '…'`），须改走 `repo.pull()`。
 * 本模块提供：
 * - {@link planBranchUpdates}：把选中本地分支短名 + for-each-ref 新鲜快照排程为逐分支动作
 *   （pull-current / fetch / skip-no-upstream）。
 * - {@link formatBranchUpdateResult}：把逐分支结果五桶汇总为通知文案与级别。
 * - {@link classifyFetchOutcome}：事后以短 sha 前缀语义把单个 fetch 动作归类 updated / upToDate。
 *
 * 与同层模块的关系：upstream 短名（`origin/x`）拆分复用 {@link resolveRemoteBranch}
 * （remote 名可含 `/`）；汇总文案复用 {@link truncateNames} 与 {@link collapseReason}；均以轻量指针保持单一事实源。
 */

import type { RawRef } from './for-each-ref';
import { resolveRemoteBranch } from './remote-ref';
import { collapseReason, truncateNames } from './cleanup';

/** 单分支更新动作（{@link planBranchUpdates} 的产物）。 */
export type BranchUpdateAction =
	| { readonly kind: 'pull-current'; readonly name: string }
	| {
		readonly kind: 'fetch';
		readonly name: string;
		readonly remote: string;
		readonly upstreamBranch: string;
		/** 更新前 objectname 短 sha（事后对比区分 updated / upToDate——fetch 静默 no-op 无输出）。 */
		readonly beforeSha: string;
	}
	| { readonly kind: 'skip-no-upstream'; readonly name: string };

/**
 * 把选中的本地分支排程为逐分支更新动作（纯逻辑）。
 *
 * 判定规则（顺序即优先级）：
 * 1. `name === headName` → pull-current：fetch refspec 对当前分支必被 git 拒绝，改走 repo.pull()
 *    （有无上游都交由 pull 报错，统一失败通道）；
 * 2. 快照缺失 / 无 upstream / upstream 无法归属任何已知 remote（陈旧 remote 场景）→ skip-no-upstream；
 * 3. 其余 → fetch，携带 {remote, upstreamBranch, beforeSha}。
 *
 * @param names 选中本地分支短名（调用方已谓词过滤/去重；此处对重复名再防御性去重）
 * @param refByShort for-each-ref 新鲜快照（key=短名，含 upstream/objectname）。
 *   树节点 ref 不可作为事实源——API 路径的 refToRaw 不填 upstream/head。
 * @param headName 当前分支名（repo.state.HEAD?.name，权威判定；detached HEAD 时 undefined）
 * @param remotes 已知 remote 名列表（repo.state.remotes，upstream 拆分的事实源）
 */
export function planBranchUpdates(
	names: readonly string[],
	refByShort: ReadonlyMap<string, RawRef>,
	headName: string | undefined,
	remotes: readonly string[],
): BranchUpdateAction[] {
	const seen = new Set<string>();
	const plan: BranchUpdateAction[] = [];
	for (const name of names) {
		if (seen.has(name)) {
			continue;
		}
		seen.add(name);
		if (name === headName) {
			plan.push({ kind: 'pull-current', name });
			continue;
		}
		const ref = refByShort.get(name);
		const target = ref?.upstream ? resolveRemoteBranch(ref.upstream, remotes) : null;
		if (!ref || !target) {
			plan.push({ kind: 'skip-no-upstream', name });
			continue;
		}
		plan.push({ kind: 'fetch', name, remote: target.remote, upstreamBranch: target.branch, beforeSha: ref.objectname });
	}
	return plan;
}

/** 单分支更新失败：分支短名 + 从 stderr/message 提取的原因。 */
export interface BranchUpdateFailure {
	readonly name: string;
	/** 失败原因（stderr 优先），可能多行。 */
	readonly reason: string;
}

/** 逐分支更新结果五桶（skip 在排程期即可定桶，其余在执行后归类）。 */
export interface BranchUpdateBuckets {
	/** fetch 后 sha 变化（真更新）。 */
	readonly updated: readonly string[];
	/** fetch 成功但 sha 不变（远程无新提交）。 */
	readonly upToDate: readonly string[];
	/** 当前分支经 repo.pull() 更新。 */
	readonly pulled: readonly string[];
	/** 无上游 / 上游无法归属已知 remote，未执行。 */
	readonly skipped: readonly string[];
	readonly failures: readonly BranchUpdateFailure[];
}

/** 通知级别：无失败走 info；存在失败走 error（联动 Show Output）。 */
export type BranchUpdateResultLevel = 'info' | 'error';

/**
 * 把逐分支更新结果五桶汇总为通知文案与级别（纯逻辑）。
 *
 * 诚实计数：各桶零计数段省略；失败项附真实原因（超 4 条截断标注）；
 * 选中数 = 五桶之和，保证用户可对账。
 */
export function formatBranchUpdateResult(buckets: BranchUpdateBuckets): {
	level: BranchUpdateResultLevel;
	message: string;
} {
	const { updated, upToDate, pulled, skipped, failures } = buckets;
	const parts: string[] = [];
	if (updated.length === 1) {
		parts.push(`Updated branch ${updated[0]}`);
	} else if (updated.length > 1) {
		parts.push(`Updated ${updated.length} branches`);
	}
	if (upToDate.length === 1) {
		parts.push(`${upToDate[0]} is already up to date`);
	} else if (upToDate.length > 1) {
		parts.push(`${upToDate.length} already up to date`);
	}
	if (pulled.length > 0) {
		// head 至多一个，pull-current 桶恒 ≤1。
		parts.push(`Pulled current branch ${pulled[0]}`);
	}
	if (skipped.length > 0) {
		parts.push(`${skipped.length} skipped (no upstream): ${truncateNames(skipped)}`);
	}
	if (failures.length === 0) {
		return { level: 'info', message: parts.join('; ') };
	}
	const entries = failures.map((f) => `${f.name} (${collapseReason(f.reason)})`);
	parts.push(`${failures.length} failed: ${truncateNames(entries, 4)}`);
	return { level: 'error', message: parts.join('; ') };
}

/**
 * 事后把单个 fetch 动作归类为 updated / upToDate（纯逻辑）。
 *
 * 前缀语义而非严格全等：`%(objectname:short)` 的缩写长度随仓库对象数自动伸缩，
 * 批量 fetch 落库新对象可能使 after 短 sha 变长（如 7→8 位），同 commit 的前后
 * 短 sha 仍互为前缀；afterSha 缺失（分支被并发删除）保守计 updated——fetch 已
 * 成功，宁报更新不报无变化。
 */
export function classifyFetchOutcome(beforeSha: string, afterSha: string | undefined): 'updated' | 'upToDate' {
	return afterSha !== undefined && afterSha.startsWith(beforeSha) ? 'upToDate' : 'updated';
}
