/**
 * Branches 视图 PR 徽标服务（adapter 层，唯一触碰 vscode/网络）。
 *
 * 编排：复用 CI 服务的 remote/provider 单一事实源（getGitHubContext）→ 取 token → GraphQL
 * 分页拉取最近更新的 PR（UPDATED_AT 倒序，全态）→ engine `buildPrIndex` 预计算匹配索引 →
 * 单槽缓存（条目携带 repoRoot 供读路径校验，切库即失效重取）+ TTL 60s；数据与索引输入均未变才
 * 续期并返回同一实例，供树侧引用相等判无变化。登录态变化即清缓存并作废在途取数（登出不留旧会话
 * 数据）；未授权不缓存（登录后即取），失败按 60s 退避、限流冷却降级为「无徽标 / 走缓存」，
 * 绝不抛错、绝不阻塞建树。
 *
 * 安全：token 仅用于 Authorization 头；`safePrUrl` 对入 Tooltip 的链接做 https + GitHub
 * 主机白名单校验（反 SSRF，镜像 CI 服务 openExternal 的姿态）。
 */

import * as vscode from 'vscode';
import type { GitRepositoryService } from '../git-repository-service';
import type { Logger } from '../../infra/logger';
import type { GitHubAuth, GitHubAuthProviderId } from '../ci/github-auth';
import type { GitHubCiService } from '../ci/github-ci-service';
import { graphqlEndpoint, isAllowedGitHubHost, parseGitHubRemote, type GitHubRemote } from '../../engine/ci/remote-parser';
import { extractRateLimit, parseRetryAfterMs } from '../../engine/ci/model';
import { fetchWithTimeout } from '../ci/graphql-http';
import { buildPrQuery } from '../../engine/pr/graphql-query';
import { parsePullRequestsResponse, prsEqual } from '../../engine/pr/model';
import { buildPrIndex, type PrRemoteInfo, type RemotePrIndex } from '../../engine/pr/match';
import type { PullRequestVM } from '../../engine/pr/types';

/** 单页 PR 数（GitHub 单页上限 100，取 50 平衡时延与点数）。 */
const PAGE_SIZE = 50;
/** 分页硬上限：最多取最近更新的 100 条 PR（超出者静默无徽标，文档化边界）。 */
const MAX_PAGES = 2;
/** 索引 TTL（ms）：分支 PR 状态变化经下一次树刷新 + TTL 到期后自然更新。 */
const TTL_MS = 60_000;
/** 失败退避（ms）：持续失败态限频重试，与 TTL 同口径（成功/失败路径均最坏 2 请求/分钟）。 */
const FAILURE_BACKOFF_MS = 60_000;
/** 单请求超时（ms）。 */
const REQUEST_TIMEOUT_MS = 15_000;
/** 剩余点数低于此阈值进入限流冷却（与 CI 服务同阈值，冷却互相独立）。 */
const RATE_FLOOR = 100;

interface CacheEntry {
	readonly repoRoot: string;
	readonly prs: readonly PullRequestVM[];
	readonly index: RemotePrIndex;
	/** 构建索引时的输入快照（remote 增删/改名/改址影响三级匹配），续期须连同比较。 */
	readonly init: { readonly repoOwner: string; readonly repoHost: string; readonly remotes: readonly PrRemoteInfo[] };
	readonly expires: number;
}

/** remotes 快照相等（顺序敏感；git 返回顺序稳定，逐项比较 name + 解析 host/owner/repo）。 */
function sameRemotes(a: readonly PrRemoteInfo[], b: readonly PrRemoteInfo[]): boolean {
	return (
		a.length === b.length &&
		a.every((v, i) => v.name === b[i].name && v.host === b[i].host && v.owner === b[i].owner && v.repo === b[i].repo)
	);
}

export class GitHubPrService implements vscode.Disposable {
	/** 登录/登出透传（订阅 GitHubAuth 会话变更），供树侧清快照重取。构造器内赋值（参数属性时序）。 */
	readonly onDidChangeAuth: vscode.Event<void>;

	private cache: CacheEntry | null = null;
	private inflight: { readonly root: string; readonly promise: Promise<RemotePrIndex | null> } | undefined;
	/** 登录态代次：登出/换号即推进并清缓存，在途取数完成时据此作废（防写回复活旧会话数据）。 */
	private authGeneration = 0;
	private cooldownUntil = 0;
	/** 失败退避截止：网络/解析失败后限频重试（登录/配置变化即重置，登录后立即重取）。 */
	private failureCooldownUntil = 0;
	private readonly abortController = new AbortController();
	private readonly disposables: vscode.Disposable[] = [];

	constructor(
		private readonly service: GitRepositoryService,
		private readonly ci: GitHubCiService,
		private readonly auth: GitHubAuth,
		private readonly logger: Logger,
	) {
		this.onDidChangeAuth = this.auth.onDidChange;
		this.disposables.push(
			// 配置开关变化后清缓存与退避（树侧同订阅触发重渲染）。
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration('hyperGit.branches.pr')) {
					this.cache = null;
					this.failureCooldownUntil = 0;
				}
			}),
			// 登录/登出：清缓存与退避 + 代次推进（作废在途取数写回），保证「登出即隐去徽标、登录后即取」。
			this.auth.onDidChange(() => {
				this.authGeneration++;
				this.cache = null;
				this.failureCooldownUntil = 0;
			}),
		);
	}

	/**
	 * 拉取（或复用）当前仓库的 PR 匹配索引。不可用（非 GitHub / 未登录 / 限流 / 关闭 / 失败）→
	 * null，绝不抛错。数据未变时返回缓存的同一索引实例（树侧引用相等即免 fire）。
	 */
	async getPullRequests(): Promise<RemotePrIndex | null> {
		if (!this.enabled()) {
			return null;
		}
		const repoRoot = this.service.repoRoot ?? '';
		if (this.inCooldown() || Date.now() < this.failureCooldownUntil) {
			// 限流冷却 / 失败退避期只走缓存（镜像 CI 策略）；单槽缓存须校验仓根，防切库后返回他仓索引。
			return this.cache?.repoRoot === repoRoot ? this.cache.index : null;
		}
		const ctx = this.ci.getGitHubContext();
		if (!ctx) {
			return null; // 非 GitHub 远程 / provider 不匹配 → 静默休眠
		}
		if (!this.isTrustedRemoteHost(ctx.remote)) {
			return null; // 「形态可解析」但非 github.com 且非已配置 GHE 实例的远程 → 视同非 GitHub（防 token 外发任意主机）
		}
		if (this.cache && this.cache.repoRoot === repoRoot && Date.now() < this.cache.expires) {
			return this.cache.index;
		}
		if (this.inflight && this.inflight.root === repoRoot) {
			return this.inflight.promise; // 同根在途去重；跨根不共用（各自按 repoRoot 写缓存）
		}
		this.inflight = { root: repoRoot, promise: this.fetchAll(ctx.remote, ctx.provider, repoRoot) };
		try {
			return await this.inflight.promise;
		} finally {
			// 只清自己的在途（跨根并发时后起者已占位，不得误清）。
			if (this.inflight?.root === repoRoot) {
				this.inflight = undefined;
			}
		}
	}

	/** Tooltip 链接防 SSRF 校验：https 且主机过共享白名单谓词（github.com、*.github.com、仓库主机、api.仓库主机）。 */
	safePrUrl(rawUrl: string): string | null {
		let uri: URL;
		try {
			uri = new URL(rawUrl);
		} catch {
			return null;
		}
		if (uri.protocol !== 'https:') {
			return null;
		}
		const remote = this.ci.getGitHubContext()?.remote;
		return isAllowedGitHubHost(uri.hostname, remote?.host) ? uri.toString() : null;
	}

	dispose(): void {
		this.abortController.abort();
		this.disposables.forEach((d) => d.dispose());
	}

	// ─── 内部 ────────────────────────────────────────────────────────────────

	/**
	 * 取数主机策略（engine `parseGitHubRemote` 只辨形态不辨主机——机制/策略分离，策略在此落地）：
	 * 仅 github.com 或与已配置 `github-enterprise.uri` 一致的实例主机可取数；其余「GitHub 形态」
	 * 远程（如 origin 指向任意第三方主机）视同非 GitHub（零徽标、零请求），杜绝把 GHE token
	 * 发往任意主机。
	 */
	private isTrustedRemoteHost(remote: GitHubRemote): boolean {
		if (remote.isGitHubDotCom) {
			return true;
		}
		const uri = vscode.workspace.getConfiguration('github-enterprise').get<string>('uri') ?? '';
		if (!uri) {
			return false;
		}
		try {
			const withScheme = /^https?:\/\//i.test(uri) ? uri : `https://${uri}`;
			return new URL(withScheme).hostname.toLowerCase() === remote.host;
		} catch {
			return false;
		}
	}

	private enabled(): boolean {
		return vscode.workspace.getConfiguration('hyperGit').get<boolean>('branches.pr.enabled', true);
	}

	private inCooldown(): boolean {
		return Date.now() < this.cooldownUntil;
	}

	/** 全量取数（分页 ≤ MAX_PAGES）→ 建索引 + 写缓存；任一页失败 → null（不缓存，留待重试）。 */
	private async fetchAll(remote: GitHubRemote, provider: GitHubAuthProviderId, repoRoot: string): Promise<RemotePrIndex | null> {
		const generation = this.authGeneration; // 取数期间的登录态代次（完成后已变则作废）
		// remotes 与 repoRoot 同时采样（首个 await 之前）：完成后才读会取到切库后他仓的列表，错配写入缓存。
		// name + URL 解析 host/owner/repo：供 Tier a 身份校验（不可解析 → null；可解析但 host 与本仓
		// 不同实例的 remote 也被 Tier a 排除——fork 与 base 同 forge 实例）。
		const remotes: readonly PrRemoteInfo[] = (this.service.repo?.state.remotes ?? []).map((r) => {
			const g = parseGitHubRemote(r.pushUrl ?? r.fetchUrl ?? '');
			return { name: r.name, host: g?.host ?? null, owner: g?.owner ?? null, repo: g?.repo ?? null };
		});
		const fetchImpl = globalThis.fetch;
		if (typeof fetchImpl !== 'function') {
			this.logger.warn('当前运行时无全局 fetch，PR 徽标不可用');
			return null;
		}
		let token: string | null;
		try {
			token = (await this.auth.peek(provider))?.accessToken ?? null;
		} catch {
			return null; // provider 未注册（GHE 未配置 uri）→ 休眠
		}
		if (!token) {
			return null; // 未授权：不缓存，登录后即取
		}
		// 网络已尝试后的失败统一走 fail()：写失败退避（限频重试），失败走同根旧缓存（与退避读路径
		// 同口径——旧索引续显而非闪烁隐现），无缓存才无徽标。
		const fail = (): RemotePrIndex | null => {
			this.failureCooldownUntil = Date.now() + FAILURE_BACKOFF_MS;
			return this.cache?.repoRoot === repoRoot ? this.cache.index : null;
		};

		const prs: PullRequestVM[] = [];
		let after: string | null = null;
		for (let page = 0; page < MAX_PAGES; page++) {
			const { query } = buildPrQuery({ first: PAGE_SIZE, after });
			const json = await this.gql(remote, provider, token, query, after);
			if (!json) {
				return fail();
			}
			const parsed = parsePullRequestsResponse(json);
			if (!parsed) {
				return fail();
			}
			prs.push(...parsed.prs);
			if (!parsed.hasNextPage || !parsed.endCursor) {
				break;
			}
			after = parsed.endCursor;
		}

		// 数据与索引输入（owner/remotes 快照）均未变：续期并返回同一索引实例（树侧引用相等 → 免 fire）。
		if (
			this.cache &&
			this.cache.repoRoot === repoRoot &&
			prsEqual(this.cache.prs, prs) &&
			this.cache.init.repoOwner === remote.owner &&
			this.cache.init.repoHost === remote.host &&
			sameRemotes(this.cache.init.remotes, remotes)
		) {
			this.cache = { ...this.cache, expires: Date.now() + TTL_MS };
			return this.cache.index;
		}
		if (generation !== this.authGeneration) {
			return null; // 取数期间登录态已变（登出/换号）：结果作废，不写缓存
		}
		const index = buildPrIndex(prs, { repoOwner: remote.owner, repoHost: remote.host, remotes });
		this.cache = { repoRoot, prs, index, init: { repoOwner: remote.owner, repoHost: remote.host, remotes }, expires: Date.now() + TTL_MS };
		return index;
	}

	/** 单次 GraphQL 请求（超时/401/403/限流处理，镜像 CI 服务 runBatch 的降级姿态）。 */
	private async gql(
		remote: GitHubRemote,
		provider: GitHubAuthProviderId,
		token: string,
		query: string,
		after: string | null,
	): Promise<unknown | null> {
		let res: Response;
		try {
			res = await fetchWithTimeout(
				globalThis.fetch,
				graphqlEndpoint(remote),
				{
					method: 'POST',
					headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'hyper-git-vscode' },
					body: JSON.stringify({ query, variables: { owner: remote.owner, name: remote.repo, after } }),
				},
				REQUEST_TIMEOUT_MS,
				this.abortController.signal,
			);
		} catch (e) {
			if ((e as Error)?.name !== 'AbortError') {
				this.logger.warn(`PR 请求失败：${(e as Error).message ?? e}`);
			}
			return null;
		}
		if (res.status === 401) {
			this.auth.invalidate(provider); // token 失效，强制下次重解析会话
			return null;
		}
		if (res.status === 403) {
			const ms = parseRetryAfterMs(res.headers.get('retry-after'));
			if (ms !== null) {
				this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + ms);
			}
			return null;
		}
		let json: unknown;
		try {
			json = await res.json();
		} catch {
			return null;
		}
		const errors = (json as { errors?: unknown[] })?.errors;
		if (Array.isArray(errors) && errors.length > 0) {
			this.logger.warn(`PR 查询返回错误：${JSON.stringify(errors[0])}`);
		}
		const rl = extractRateLimit(json);
		if (rl && rl.remaining !== null && rl.remaining < RATE_FLOOR) {
			const until = rl.resetAt ? Date.parse(rl.resetAt) : NaN;
			this.cooldownUntil = Math.max(this.cooldownUntil, Number.isNaN(until) ? Date.now() + 60_000 : until);
		}
		return json;
	}
}
