/**
 * GraphQL 响应 → {@link CiStatusVM} 解析（纯逻辑，零 vscode/网络依赖）。
 *
 * 按构造端约定的别名序号（{@link CI_ALIAS_PREFIX} + i）回填 oid → hash。响应形态宽容：
 * 别名值为 null（提交未推送到远程，远程无此 object）→ unknown（不渲染图标）；rollup 缺失
 * （无 CI 配置）→ unknown；缺 `data`/含 `errors` 时整批回退 unknown，不抛错（单次解析不中断）。
 */

import { CI_ALIAS_PREFIX } from './graphql-query';
import { aggregateChecks, checkRunState, mapRollupState, statusContextState } from './rollup';
import type { CiCheckVM, CiStatusVM } from './types';

/** 空响应（无 CI / 未推送 / 解析失败）的统一 VM。 */
export const UNKNOWN_CI: CiStatusVM = Object.freeze({
	state: 'unknown',
	checks: [],
	passed: 0,
	total: 0,
});

/** rateLimit 抽取（供 adapter 自适应限流冷却）。 */
export interface RateLimitInfo {
	readonly remaining: number | null;
	readonly resetAt: string | null;
}

/** 从响应体抽取 rateLimit（缺失返回 null）。 */
export function extractRateLimit(json: unknown): RateLimitInfo | null {
	const rl = (json as { data?: { rateLimit?: { remaining?: unknown; resetAt?: unknown } } })?.data?.rateLimit;
	if (!rl) {
		return null;
	}
	return {
		remaining: typeof rl.remaining === 'number' ? rl.remaining : null,
		resetAt: typeof rl.resetAt === 'string' ? rl.resetAt : null,
	};
}

type RawNode = Record<string, unknown> | null | undefined;

/** 单个 context（CheckRun 或 StatusContext）归一为 {@link CiCheckVM}；不可识别返回 null。 */
function normalizeContext(node: RawNode): CiCheckVM | null {
	if (!node || typeof node !== 'object') {
		return null;
	}
	const typename = node.__typename;
	if (typename === 'CheckRun') {
		const status = (node.status as string | null | undefined) ?? null;
		const conclusion = (node.conclusion as string | null | undefined) ?? null;
		return {
			name: String(node.name ?? 'check'),
			state: checkRunState(status, conclusion),
			conclusion: conclusion ?? status ?? undefined,
			url: (node.detailsUrl as string | undefined) || undefined,
		};
	}
	if (typename === 'StatusContext') {
		const raw = (node.state as string | null | undefined) ?? null;
		return {
			name: String(node.context ?? 'status'),
			state: statusContextState(raw),
			conclusion: raw ?? undefined,
			description: (node.description as string | undefined) || undefined,
			url: (node.targetUrl as string | undefined) || undefined,
		};
	}
	return null;
}

/** 单个别名节点 → {@link CiStatusVM}。null/无 rollup/空 contexts 统一回退 {@link UNKNOWN_CI}。 */
function parseCommitNode(node: RawNode): CiStatusVM {
	if (!node) {
		return UNKNOWN_CI;
	}
	const rollup = (node as { statusCheckRollup?: RawNode }).statusCheckRollup;
	if (!rollup) {
		return UNKNOWN_CI;
	}
	const rollupState = mapRollupState((rollup as { state?: unknown }).state as string | undefined);
	const nodes = (rollup as { contexts?: { nodes?: RawNode[] } }).contexts?.nodes ?? [];
	const checks = nodes
		.map((n) => normalizeContext(n))
		.filter((c): c is CiCheckVM => c !== null);
	return aggregateChecks(rollupState, checks);
}

/**
 * 解析整批响应为 `hash → CiStatusVM`。按别名序号与 `requestedOids` 同序映射；
 * 缺 `data`/`repository` 时仍为每个 oid 回填 unknown（保序、不抛错）。
 */
export function parseCiResponse(json: unknown, requestedOids: readonly string[]): Map<string, CiStatusVM> {
	const map = new Map<string, CiStatusVM>();
	const repository = (json as { data?: { repository?: Record<string, RawNode> } })?.data?.repository;
	for (let i = 0; i < requestedOids.length; i++) {
		const alias = CI_ALIAS_PREFIX + i;
		const node = repository ? repository[alias] : undefined;
		map.set(requestedOids[i], parseCommitNode(node));
	}
	return map;
}
