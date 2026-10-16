/**
 * Branches 视图 PR 徽标服务（adapter 层，唯一触碰 vscode/网络）。
 *
 * 编排：复用 CI 服务的 remote/provider 单一事实源（getGitHubContext）→ 取 token → GraphQL
 * 分页拉取最近更新的 PR（UPDATED_AT 倒序，全态）→ engine `buildPrIndex` 预计算匹配索引 →
 * 按 repoRoot + TTL 60s 缓存（数据未变续期并返回同一实例，供树侧引用相等判无变化）。
 * 未授权不缓存（登录后即取），失败/限流降级为「无徽标 / 走缓存」，绝不抛错、绝不阻塞建树。
 *
 * 安全：token 仅用于 Authorization 头；`safePrUrl` 对入 Tooltip 的链接做 https + GitHub
 * 主机白名单校验（反 SSRF，镜像 CI 服务 openExternal 的姿态）。
 */

import * as vscode from 'vscode';
import type { GitRepositoryService } from '../git-repository-service';
import type { Logger } from '../../infra/logger';
import type { GitHubAuth, GitHubAuthProviderId } from '../ci/github-auth';
import type { GitHubCiService } from '../ci/github-ci-service';
import { graphqlEndpoint, type GitHubRemote } from '../../engine/ci/remote-parser';
import { extractRateLimit } from '../../engine/ci/model';
import { buildPrQuery } from '../../engine/pr/graphql-query';
import { parsePullRequestsResponse, prsEqual } from '../../engine/pr/model';
import { buildPrIndex, type RemotePrIndex } from '../../engine/pr/match';
import type { PullRequestVM } from '../../engine/pr/types';

/** 单页 PR 数（GitHub 单页上限 100，取 50 平衡时延与点数）。 */
const PAGE_SIZE = 50;
/** 分页硬上限：最多取最近更新的 100 条 PR（超出者静默无徽标，文档化边界）。 */
const MAX_PAGES = 2;
/** 索引 TTL（ms）：分支 PR 状态变化经下一次树刷新 + TTL 到期后自然更新。 */
const TTL_MS = 60_000;
/** 单请求超时（ms）。 */
const REQUEST_TIMEOUT_MS = 15_000;
/** 剩余点数低于此阈值进入限流冷却（与 CI 服务同阈值，冷却互相独立）。 */
const RATE_FLOOR = 100;

interface CacheEntry {
	readonly repoRoot: string;
	readonly prs: readonly PullRequestVM[];
	readonly index: RemotePrIndex;
	readonly expires: number;
}

export class GitHubPrService implements vscode.Disposable {
	/** 登录/登出透传（订阅 GitHubAuth 会话变更），供树侧清快照重取。构造器内赋值（参数属性时序）。 */
	readonly onDidChangeAuth: vscode.Event<void>;

	private cache: CacheEntry | null = null;
	private inflight: Promise<RemotePrIndex | null> | undefined;
	private cooldownUntil = 0;
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
			// 配置开关变化后清缓存（树侧同订阅触发重渲染）。
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration('hyperGit.branches.pr')) {
					this.cache = null;
				}
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
		if (this.inCooldown()) {
			return this.cache?.index ?? null; // 冷却期只走缓存（镜像 CI 策略）
		}
		const ctx = this.ci.getGitHubContext();
		if (!ctx) {
			return null; // 非 GitHub 远程 / provider 不匹配 → 静默休眠
		}
		const repoRoot = this.service.repoRoot ?? '';
		if (this.cache && this.cache.repoRoot === repoRoot && Date.now() < this.cache.expires) {
			return this.cache.index;
		}
		if (this.inflight) {
			return this.inflight;
		}
		this.inflight = this.fetchAll(ctx.remote, ctx.provider, repoRoot);
		try {
			return await this.inflight;
		} finally {
			this.inflight = undefined;
		}
	}

	/** Tooltip 链接防 SSRF 校验：https 且主机 ∈ {github.com, *.github.com, 仓库主机, api.仓库主机}。 */
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
		const host = uri.hostname.toLowerCase();
		const remote = this.ci.getGitHubContext()?.remote;
		const allowed =
			host === 'github.com' ||
			host.endsWith('.github.com') ||
			(!!remote && (host === remote.host || host === `api.${remote.host}`));
		return allowed ? uri.toString() : null;
	}

	dispose(): void {
		this.abortController.abort();
		this.disposables.forEach((d) => d.dispose());
	}

	// ─── 内部 ────────────────────────────────────────────────────────────────

	private enabled(): boolean {
		return vscode.workspace.getConfiguration('hyperGit').get<boolean>('branches.pr.enabled', true);
	}

	private inCooldown(): boolean {
		return Date.now() < this.cooldownUntil;
	}

	/** 全量取数（分页 ≤ MAX_PAGES）→ 建索引 + 写缓存；任一页失败 → null（不缓存，留待重试）。 */
	private async fetchAll(remote: GitHubRemote, provider: GitHubAuthProviderId, repoRoot: string): Promise<RemotePrIndex | null> {
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

		const prs: PullRequestVM[] = [];
		let after: string | null = null;
		for (let page = 0; page < MAX_PAGES; page++) {
			const { query } = buildPrQuery({ first: PAGE_SIZE, after });
			const json = await this.gql(remote, provider, token, query, after);
			if (!json) {
				return null;
			}
			const parsed = parsePullRequestsResponse(json);
			if (!parsed) {
				return null;
			}
			prs.push(...parsed.prs);
			if (!parsed.hasNextPage || !parsed.endCursor) {
				break;
			}
			after = parsed.endCursor;
		}

		// 数据未变：续期并返回同一索引实例（树侧引用相等 → 免 fire）。
		if (this.cache && this.cache.repoRoot === repoRoot && prsEqual(this.cache.prs, prs)) {
			this.cache = { ...this.cache, expires: Date.now() + TTL_MS };
			return this.cache.index;
		}
		const remotes = (this.service.repo?.state.remotes ?? []).map((r) => r.name);
		const index = buildPrIndex(prs, { repoOwner: remote.owner, remotes });
		this.cache = { repoRoot, prs, index, expires: Date.now() + TTL_MS };
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
			res = await this.fetchWithTimeout(globalThis.fetch, graphqlEndpoint(remote), {
				method: 'POST',
				headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'hyper-git-vscode' },
				body: JSON.stringify({ query, variables: { owner: remote.owner, name: remote.repo, after } }),
			});
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
			const retryAfter = res.headers.get('retry-after');
			if (retryAfter) {
				this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + Number(retryAfter) * 1000);
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

	/** fetch + 超时/销毁可中止（每请求独立 AbortController，挂到全局 dispose 信号）。 */
	private async fetchWithTimeout(
		fetchImpl: typeof globalThis.fetch,
		url: string,
		init: RequestInit,
	): Promise<Response> {
		const reqAc = new AbortController();
		const onDispose = (): void => reqAc.abort();
		this.abortController.signal.addEventListener('abort', onDispose, { once: true });
		const timer = setTimeout(() => reqAc.abort(), REQUEST_TIMEOUT_MS);
		try {
			return await fetchImpl(url, { ...init, signal: reqAc.signal });
		} finally {
			clearTimeout(timer);
			this.abortController.signal.removeEventListener('abort', onDispose);
		}
	}
}
