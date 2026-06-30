/**
 * GitHub CI 服务（adapter 层，唯一触碰 vscode/网络）。
 *
 * 编排：解析 origin 远程 → GitHub 坐标 → 取 token → GraphQL 批量取 `statusCheckRollup` →
 * 按 oid 缓存（终态永久 / pending 30s TTL）→ 回填 webview。CI 懒加载、仅取可见行、终态整会话缓存，
 * 从根本上规避 1000 提交触发 1000 请求的限流风暴。失败一律降级为「无图标 / 走缓存」，绝不阻塞建图。
 *
 * 安全：token 仅用于 Authorization 头，不入日志/webview；`openExternal` 校验主机属 GitHub（反 SSRF，
 * detailsUrl 属观察内容不盲信）。
 */

import * as vscode from 'vscode';
import type { GitRepositoryService } from '../git-repository-service';
import type { Logger } from '../../infra/logger';
import { GitHubAuth, type GitHubAuthProviderId } from './github-auth';
import { buildCiQuery } from '../../engine/ci/graphql-query';
import { extractRateLimit, parseCiResponse } from '../../engine/ci/model';
import { authProviderId, graphqlEndpoint, parseGitHubRemote, type GitHubRemote } from '../../engine/ci/remote-parser';
import type { CiStatusVM } from '../../engine/ci/types';

/** 单次 GraphQL 拉取的 oid 上限（与可见窗口粒度对齐，文档体积与单点成本均衡）。 */
const MAX_OIDS_PER_QUERY = 100;
/** GraphQL 并发上限（滚动连发时保护 GitHub）。 */
const MAX_CONCURRENT = 2;
/** 单请求超时（ms）。 */
const REQUEST_TIMEOUT_MS = 15_000;
/** pending / unknown 缓存 TTL（ms）—— 运行中或未推送的提交短时刷新。 */
const PENDING_TTL_MS = 30_000;
/** 剩余点数低于此阈值进入限流冷却（直到 resetAt）。 */
const RATE_FLOOR = 100;

export interface CiServiceStatus {
	/** 远程为 GitHub 且功能启用：可显示图标/发请求。 */
	readonly available: boolean;
	/** 远程是 GitHub 但未授权：webview 显示「登录」提示。 */
	readonly needsAuth: boolean;
	/** 软错误摘要（限流/运行时无 fetch）。 */
	readonly error?: string;
}

interface RemoteCacheEntry {
	readonly repoRoot: string;
	readonly remote: GitHubRemote | null;
}

interface CacheEntry {
	readonly vm: CiStatusVM;
	readonly expires: number; // Infinity 表示整会话
}

/** 简易异步信号量（控制并发请求数）。 */
class Semaphore {
	private active = 0;
	private readonly waiters: Array<() => void> = [];
	constructor(private readonly max: number) {}
	async acquire(): Promise<void> {
		if (this.active < this.max) {
			this.active++;
			return;
		}
		await new Promise<void>((resolve) => this.waiters.push(resolve));
	}
	release(): void {
		if (this.waiters.length > 0) {
			this.waiters.shift()!(); // 直接把槽位移交给等待者，active 不变
		} else {
			this.active--;
		}
	}
}

export class GitHubCiService implements vscode.Disposable {
	private remoteCache: RemoteCacheEntry | null = null;
	private readonly cache = new Map<string, CacheEntry>();
	private readonly inflight = new Map<string, Promise<CiStatusVM | undefined>>();
	private cooldownUntil = 0;
	private readonly semaphore = new Semaphore(MAX_CONCURRENT);
	private readonly abortController = new AbortController();
	private readonly disposables: vscode.Disposable[] = [];

	constructor(
		private readonly service: GitRepositoryService,
		private readonly auth: GitHubAuth,
		private readonly logger: Logger,
	) {
		this.disposables.push(
			// 配置变更（开关/provider/远程）后重算可用性。
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration('hyperGit.log.ci')) {
					this.remoteCache = null;
				}
			}),
		);
	}

	// ─── 对外能力 ────────────────────────────────────────────────────────────

	/** 当前仓库的 CI 能力 + 授权态（廉价：复用缓存会话，不阻塞建图）。 */
	async status(): Promise<CiServiceStatus> {
		if (!this.enabled()) {
			return { available: false, needsAuth: false };
		}
		const remote = this.resolveRemote();
		const provider = remote ? this.providerIdFor(remote) : null;
		if (!remote || !provider) {
			return { available: false, needsAuth: false };
		}
		if (typeof globalThis.fetch !== 'function') {
			return { available: false, needsAuth: false, error: 'No global fetch in current runtime' };
		}
		try {
			const session = await this.auth.peek(provider);
			return { available: true, needsAuth: !session, error: this.cooldownError() };
		} catch {
			// provider 未注册（GHE 未配置 github-enterprise.uri）→ 功能休眠，不报错。
			return { available: false, needsAuth: false };
		}
	}

	/** 批量取 CI 状态（缓存优先 + in-flight 去重 + 批量 GraphQL）。 */
	async getStatuses(hashes: readonly string[]): Promise<Map<string, CiStatusVM>> {
		const result = new Map<string, CiStatusVM>();
		if (hashes.length === 0 || !this.enabled()) {
			return result;
		}
		const remote = this.resolveRemote();
		const provider = remote ? this.providerIdFor(remote) : null;
		if (!remote || !provider) {
			return result;
		}

		const uniq = [...new Set(hashes)];
		const toAwait: Array<[string, Promise<CiStatusVM | undefined>]> = [];
		const toFetch: string[] = [];
		for (const h of uniq) {
			const cached = this.readCache(h);
			if (cached) {
				result.set(h, cached);
				continue;
			}
			const existing = this.inflight.get(h);
			if (existing) {
				toAwait.push([h, existing]);
			} else {
				toFetch.push(h);
			}
		}

		if (toFetch.length > 0 && !this.inCooldown()) {
			for (const batch of this.chunk(toFetch, MAX_OIDS_PER_QUERY)) {
				const batchPromise = this.runBatch(remote, provider, batch);
				for (const h of batch) {
					const p = batchPromise.then((m) => m.get(h));
					this.inflight.set(h, p);
					toAwait.push([h, p]);
				}
			}
		}

		if (toAwait.length === 0) {
			return result;
		}
		const settled = await Promise.all(toAwait.map(async ([h, p]) => [h, (await p) as CiStatusVM | undefined] as const));
		for (const [h, vm] of settled) {
			this.inflight.delete(h);
			if (vm) {
				this.writeCache(h, vm);
				result.set(h, vm);
			}
		}
		return result;
	}

	/** 交互式登录（命令触发）。 */
	async signIn(): Promise<boolean> {
		const remote = this.resolveRemote();
		const provider = remote ? this.providerIdFor(remote) : null;
		if (!remote || !provider) {
			return false;
		}
		try {
			const session = await this.auth.signIn(provider);
			return !!session;
		} catch {
			return false;
		}
	}

	/** 校验后打开外部链接（反 SSRF：仅放行 GitHub 主机）。 */
	async openExternal(rawUrl: string): Promise<void> {
		let uri: vscode.Uri;
		try {
			uri = vscode.Uri.parse(rawUrl, true);
		} catch {
			return;
		}
		if (uri.scheme !== 'https') {
			return;
		}
		const host = uri.authority.toLowerCase();
		const remote = this.resolveRemote();
		const allowed =
			host === 'github.com' ||
			host.endsWith('.github.com') ||
			(!!remote && (host === remote.host || host === `api.${remote.host}`));
		if (!allowed) {
			this.logger.warn(`拒绝打开非 GitHub 链接：${rawUrl}`);
			return;
		}
		await vscode.env.openExternal(uri);
	}

	dispose(): void {
		this.abortController.abort();
		this.inflight.clear();
		this.disposables.forEach((d) => d.dispose());
	}

	// ─── 配置 / 远程解析 ──────────────────────────────────────────────────────

	private enabled(): boolean {
		return vscode.workspace.getConfiguration('hyperGit').get<boolean>('log.ci.enabled', true);
	}

	private providerConfig(): 'auto' | 'github.com' | 'github-enterprise' {
		return vscode.workspace.getConfiguration('hyperGit').get<'auto' | 'github.com' | 'github-enterprise'>(
			'log.ci.provider',
			'auto',
		);
	}

	private remoteNameConfig(): string {
		return vscode.workspace.getConfiguration('hyperGit').get<string>('log.ci.remote', '') ?? '';
	}

	/** 远程 → 认证 provider（依据配置与主机；不匹配返回 null → 功能休眠）。 */
	private providerIdFor(remote: GitHubRemote): GitHubAuthProviderId | null {
		const cfg = this.providerConfig();
		if (cfg === 'github.com') {
			return remote.isGitHubDotCom ? 'github' : null;
		}
		if (cfg === 'github-enterprise') {
			return remote.isGitHubDotCom ? null : 'github-enterprise';
		}
		// auto：信任远程主机探测（github.com → github，其余 → github-enterprise）。
		return authProviderId(remote);
	}

	/** 解析当前仓库远程为 GitHub 坐标（按 repoRoot 缓存；优先配置名 → origin → 首个可解析）。 */
	private resolveRemote(): GitHubRemote | null {
		const repoRoot = this.service.repoRoot ?? '';
		if (this.remoteCache && this.remoteCache.repoRoot === repoRoot) {
			return this.remoteCache.remote;
		}
		let remote: GitHubRemote | null = null;
		const remotes = this.service.repo?.state.remotes ?? [];
		if (remotes.length > 0) {
			const preferred = this.remoteNameConfig().trim();
			const pick = (r: { fetchUrl?: string; pushUrl?: string }): string => r.pushUrl ?? r.fetchUrl ?? '';
			const ordered: Array<{ fetchUrl?: string; pushUrl?: string }> = [];
			if (preferred) {
				const hit = remotes.find((r) => r.name === preferred);
				if (hit) {
					ordered.push(hit);
				}
			}
			const origin = remotes.find((r) => r.name === 'origin');
			if (origin) {
				ordered.push(origin);
			}
			ordered.push(...remotes);
			for (const cand of ordered) {
				remote = parseGitHubRemote(pick(cand));
				if (remote) {
					break;
				}
			}
		}
		this.remoteCache = { repoRoot, remote };
		return remote;
	}

	// ─── 缓存 / 限流 ─────────────────────────────────────────────────────────

	private readCache(hash: string): CiStatusVM | undefined {
		const entry = this.cache.get(hash);
		if (!entry) {
			return undefined;
		}
		if (entry.expires !== Infinity && Date.now() > entry.expires) {
			this.cache.delete(hash);
			return undefined;
		}
		return entry.vm;
	}

	private writeCache(hash: string, vm: CiStatusVM): void {
		const terminal = vm.state === 'success' || vm.state === 'failure';
		this.cache.set(hash, { vm, expires: terminal ? Infinity : Date.now() + PENDING_TTL_MS });
	}

	private inCooldown(): boolean {
		return Date.now() < this.cooldownUntil;
	}

	private cooldownError(): string | undefined {
		if (!this.inCooldown()) {
			return undefined;
		}
		const secs = Math.ceil((this.cooldownUntil - Date.now()) / 1000);
		return `GitHub rate limited, resumes in ~${secs}s`;
	}

	// ─── 取数 ────────────────────────────────────────────────────────────────

	private chunk<T>(arr: readonly T[], size: number): T[][] {
		const out: T[][] = [];
		for (let i = 0; i < arr.length; i += size) {
			out.push(arr.slice(i, i + size));
		}
		return out;
	}

	/** 单批 GraphQL 取数（带并发闸、超时、401/403/限流处理）。失败返回空 Map（不缓存，留待重试）。 */
	private async runBatch(remote: GitHubRemote, provider: GitHubAuthProviderId, oids: string[]): Promise<Map<string, CiStatusVM>> {
		const map = new Map<string, CiStatusVM>();
		if (oids.length === 0) {
			return map;
		}
		const fetchImpl = globalThis.fetch;
		if (typeof fetchImpl !== 'function') {
			this.logger.warn('当前运行时无全局 fetch，CI 功能不可用');
			return map;
		}
		const token = await this.acquireToken(provider);
		if (!token) {
			return map; // 未授权：不缓存，待登录后重试
		}

		const { query } = buildCiQuery({ owner: remote.owner, name: remote.repo, oids });
		const endpoint = graphqlEndpoint(remote);
		const body = JSON.stringify({ query, variables: { owner: remote.owner, name: remote.repo } });

		await this.semaphore.acquire();
		try {
			const res = await this.fetchWithTimeout(fetchImpl, endpoint, {
				method: 'POST',
				headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'hyper-git-vscode' },
				body,
			});
			if (res.status === 401) {
				this.auth.invalidate(provider); // token 失效，强制下次重解析会话
				return map;
			}
			if (res.status === 403) {
				const retryAfter = res.headers.get('retry-after');
				if (retryAfter) {
					this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + Number(retryAfter) * 1000);
				}
				return map;
			}
			let json: unknown;
			try {
				json = await res.json();
			} catch {
				return map;
			}
			const errors = (json as { errors?: unknown[] })?.errors;
			if (Array.isArray(errors) && errors.length > 0) {
				this.logger.warn(`CI 查询返回错误：${JSON.stringify(errors[0])}`);
			}
			const rl = extractRateLimit(json);
			if (rl && rl.remaining !== null && rl.remaining < RATE_FLOOR) {
				const until = rl.resetAt ? Date.parse(rl.resetAt) : NaN;
				this.cooldownUntil = Math.max(this.cooldownUntil, Number.isNaN(until) ? Date.now() + 60_000 : until);
			}
			for (const [h, vm] of parseCiResponse(json, oids)) {
				map.set(h, vm);
			}
		} catch (e) {
			if ((e as Error)?.name !== 'AbortError') {
				this.logger.warn(`CI 请求失败：${(e as Error).message ?? e}`);
			}
		} finally {
			this.semaphore.release();
		}
		return map;
	}

	/** fetch + 超时/销毁可中止（每个请求独立 AbortController，挂到全局 dispose 信号）。 */
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

	private async acquireToken(provider: GitHubAuthProviderId): Promise<string | null> {
		try {
			const session = await this.auth.peek(provider);
			return session?.accessToken ?? null;
		} catch {
			return null;
		}
	}
}
