/**
 * 远程分支 → Pull Request 匹配（纯逻辑，零 vscode 依赖）。
 *
 * 匹配对象是「剥掉 remote 前缀后的分支路径」与 PR 的 `headRefName`（head 仓库内的分支名）。
 * 前缀剥离复用 {@link resolveRemoteBranch} 的最长前缀匹配（remote 名可含 `/`）。三级优先：
 * - **a（fork 全名 + remote 身份校验）**：shortName 恰为 `${headOwner}/${headRefName}`，且首段
 *   是真实存在的 remote、其 URL 解析 host/owner/repo 与本仓 host 及 PR 的 head owner/head repo
 *   一致（owner/repo 大小写不敏感、host 与本仓同实例；fork 惯例保留 base 仓库名，同 host+owner+repo
 *   即本仓 fork）——remote 本身以 fork owner 命名（如 `mylogin/feature`）的场景，无需剥离即精确命中；
 *   身份校验排除 login 与 remote 名撞名（如贡献者 login 恰为 `origin`）、含 `/` remote 名与
 *   owner/branch 键同形、remote 指向同/异 owner 他仓他实例的错误命中；
 * - **b（同仓）**：剥离后 `branch === headRefName && headOwner === repoOwner`——dependabot /
 *   仓内功能分支的主场景；
 * - **c（唯一兜底）**：剥离后 `branch === headRefName` 且候选唯一；歧义（多 fork 同名分支）→
 *   不匹配（宁缺勿错，绝不显示错误 PR）。
 *
 * owner 比较大小写不敏感（GitHub owner 查询不敏感、login 返回规范形，而远程 URL 侧原样保留），
 * 分支名保持大小写敏感。
 *
 * 同一 headRefName 多条 PR（复用分支名）取 `updatedAt` 最近一条。
 */

import { resolveRemoteBranch } from '../ref/remote-ref';
import type { PullRequestVM } from './types';

/** Tier a 身份校验用的 remote 描述（name + URL 解析出的 host/owner/repo；null = 不可解析形态）。 */
export interface PrRemoteInfo {
	readonly name: string;
	readonly host: string | null;
	readonly owner: string | null;
	readonly repo: string | null;
}

/** buildPrIndex 入参（构建期快照）。 */
export interface PrIndexInit {
	/** 当前仓库 owner（Tier b 同仓判定基准；owner 比较大小写不敏感——URL 形与规范 login 可不同）。 */
	readonly repoOwner: string;
	/** 当前仓库主机（小写；fork 与 base 同实例，Tier a 要求 remote host 与之一致，排除跨 forge 撞名）。 */
	readonly repoHost: string;
	/** 已知 remote 列表（name + URL 解析 host/owner/repo；最长前缀剥离与 Tier a 身份校验共用，事实源 `repo.state.remotes`）。 */
	readonly remotes: readonly PrRemoteInfo[];
}

/** 预计算索引；Branches 树逐行 O(1) 查询。 */
export interface RemotePrIndex {
	lookup(shortName: string): PullRequestVM | undefined;
}

/** `updatedAt` 近者胜（解析失败按 -∞ 处理，恒不优于合法值）。 */
function newer(a: PullRequestVM, b: PullRequestVM): PullRequestVM {
	const ta = Date.parse(a.updatedAt);
	const tb = Date.parse(b.updatedAt);
	return (Number.isNaN(ta) ? -Infinity : ta) >= (Number.isNaN(tb) ? -Infinity : tb) ? a : b;
}

/** 构建索引：三个 Map 预计算，lookup 侧零遍历。owner 段统一折叠小写（GitHub owner 大小写不敏感，
 * `headRepositoryOwner.login` 返回规范形而远程 URL 侧原样），`headRefName`/branch 保持大小写敏感。 */
export function buildPrIndex(prs: readonly PullRequestVM[], init: PrIndexInit): RemotePrIndex {
	// Tier a：`owner/branch` 全名（headOwner 缺失的 PR 不参与；owner 段小写键）。
	const byForkFullName = new Map<string, PullRequestVM>();
	// Tier b：同仓 PR 按 headRefName。
	const bySameRepoBranch = new Map<string, PullRequestVM>();
	// Tier c 兜底：全部 PR 按 headRefName（唯一才采用）。
	const byBranchAll = new Map<string, PullRequestVM[]>();
	// Tier b/c 最长前缀剥离用纯名列表；Tier a 身份校验用 remote 名 → URL host/owner/repo（owner/repo 双侧小写）。
	const remoteNames = init.remotes.map((r) => r.name);
	const repoHost = init.repoHost.toLowerCase();
	const remoteIdentity = new Map<string, { host: string; owner: string; repo: string } | null>(
		init.remotes.map((r) =>
			[r.name.toLowerCase(), !r.host || !r.owner || !r.repo ? null : { host: r.host.toLowerCase(), owner: r.owner.toLowerCase(), repo: r.repo.toLowerCase() }] as const,
		),
	);
	const repoOwner = init.repoOwner.toLowerCase();
	for (const pr of prs) {
		if (pr.headOwner) {
			const full = `${pr.headOwner.toLowerCase()}/${pr.headRefName}`;
			byForkFullName.set(full, byForkFullName.has(full) ? newer(byForkFullName.get(full)!, pr) : pr);
		}
		if (pr.headOwner.toLowerCase() === repoOwner) {
			bySameRepoBranch.set(pr.headRefName, bySameRepoBranch.has(pr.headRefName) ? newer(bySameRepoBranch.get(pr.headRefName)!, pr) : pr);
		}
		const list = byBranchAll.get(pr.headRefName);
		if (list) {
			list.push(pr);
		} else {
			byBranchAll.set(pr.headRefName, [pr]);
		}
	}
	return {
		lookup(shortName: string): PullRequestVM | undefined {
			// Tier a：fork 全名精确命中（首段即 owner，折叠小写后查键）＋ 身份校验——首段必须是真实
			// 存在的可解析 remote，且其 URL 解析 host 与本仓同实例、owner/repo 与命中 PR 的 head
			// owner/head repo 双侧小写一致（防撞名与异仓劫持，见模块头注；headRepo 缺失 → '' 恒不匹配，宁缺勿错）。
			const slash = shortName.indexOf('/');
			if (slash >= 0) {
				const seg = shortName.slice(0, slash).toLowerCase();
				const forkHit = byForkFullName.get(seg + shortName.slice(slash));
				const identity = remoteIdentity.get(seg);
				if (
					forkHit &&
					identity &&
					identity.host === repoHost &&
					identity.owner === forkHit.headOwner.toLowerCase() &&
					identity.repo === forkHit.headRepo.toLowerCase()
				) {
					return forkHit;
				}
			}
			// 剥离 remote 前缀（最长前缀；纯 remote 名 / 未知 remote → null → 不匹配）。
			const target = resolveRemoteBranch(shortName, remoteNames);
			if (!target) {
				return undefined;
			}
			// Tier b：同仓 PR。
			const sameRepo = bySameRepoBranch.get(target.branch);
			if (sameRepo) {
				return sameRepo;
			}
			// Tier c：全量候选唯一才采用；歧义宁缺。
			const all = byBranchAll.get(target.branch);
			if (!all || all.length !== 1) {
				return undefined;
			}
			return all[0];
		},
	};
}

/** 单发便捷形态（= buildPrIndex(prs, init).lookup(shortName)），主供测试与零星调用。 */
export function matchRemoteBranchPr(shortName: string, init: PrIndexInit, prs: readonly PullRequestVM[]): PullRequestVM | undefined {
	return buildPrIndex(prs, init).lookup(shortName);
}
