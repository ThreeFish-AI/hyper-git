/**
 * GraphQL 响应 → {@link PullRequestVM} 解析（纯逻辑，零 vscode/网络依赖）。
 *
 * 响应形态宽容（镜像 `engine/ci/model.ts`）：节点级异常（非法 state / 非正数 number）丢弃该
 * 节点不中断整批；缺 `data`/`repository`/`pullRequests`（含 errors-only 响应）整体返回 null，
 * 调用方放弃本次且不缓存，留待重试。
 */

import type { PrState, PullRequestVM } from './types';

/** 单页解析结果。 */
export interface PrPage {
	readonly prs: readonly PullRequestVM[];
	readonly hasNextPage: boolean;
	readonly endCursor: string | null;
}

const KNOWN_STATES: readonly PrState[] = ['OPEN', 'MERGED', 'CLOSED'];

type RawNode = Record<string, unknown> | null | undefined;

/** 字段级字符串守卫：非字符串（含缺失）→ ''，杜绝盲转型把 number/boolean/object 放进 VM。 */
function asString(v: unknown): string {
	return typeof v === 'string' ? v : '';
}

/** 单节点 → {@link PullRequestVM}；state 未知 / number 非正数 → null（丢弃）。 */
function parseNode(node: RawNode): PullRequestVM | null {
	if (!node || typeof node !== 'object') {
		return null;
	}
	const state = node.state as string | null | undefined;
	if (typeof state !== 'string' || !KNOWN_STATES.includes(state as PrState)) {
		return null;
	}
	const number_ = node.number;
	if (typeof number_ !== 'number' || !Number.isInteger(number_) || number_ <= 0) {
		return null;
	}
	const owner = (node.headRepositoryOwner as { login?: unknown } | null | undefined)?.login;
	return {
		number: number_,
		state: state as PrState,
		isDraft: node.isDraft === true,
		title: asString(node.title),
		url: asString(node.url),
		updatedAt: asString(node.updatedAt),
		headRefName: asString(node.headRefName),
		// fork 元数据可能为 null（如 head 仓库被删除）→ ''，不参与 fork 全名匹配。
		headOwner: typeof owner === 'string' ? owner : '',
	};
}

/**
 * 解析整页响应。缺 `data`/`repository`/`pullRequests` → null（不缓存，留待重试）；
 * `nodes: null` / 非数组 → 空页（合法：仓库无 PR / 宽容降级）。
 */
export function parsePullRequestsResponse(json: unknown): PrPage | null {
	const conn = (json as { data?: { repository?: { pullRequests?: RawConn } } })?.data?.repository?.pullRequests;
	if (!conn) {
		return null;
	}
	const rawNodes = (conn as RawConn).nodes;
	const nodes = Array.isArray(rawNodes) ? rawNodes : [];
	const prs = nodes.map((n) => parseNode(n)).filter((p): p is PullRequestVM => p !== null);
	const pageInfo = (conn as RawConn).pageInfo;
	return {
		prs,
		hasNextPage: pageInfo?.hasNextPage === true,
		endCursor: typeof pageInfo?.endCursor === 'string' ? pageInfo.endCursor : null,
	};
}

interface RawConn {
	nodes?: RawNode[] | null;
	pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } | null;
}

/** OPEN+draft → Draft；OPEN → Open；MERGED/CLOSED 原词。 */
export function prStateLabel(pr: Pick<PullRequestVM, 'state' | 'isDraft'>): string {
	if (pr.state === 'OPEN' && pr.isDraft) {
		return 'Draft';
	}
	const map: Record<PrState, string> = { OPEN: 'Open', MERGED: 'Merged', CLOSED: 'Closed' };
	return map[pr.state];
}

/** Branches 行内描述徽标：`#138 Merged` 形态。 */
export function prBadge(pr: PullRequestVM): string {
	return `#${pr.number} ${prStateLabel(pr)}`;
}

/** 深比较（TTL 重取后数据未变 → 服务层续期并返回同一索引实例，抑制无效 fire）。 */
export function prsEqual(a: readonly PullRequestVM[], b: readonly PullRequestVM[]): boolean {
	if (a === b) {
		return true;
	}
	if (a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i++) {
		const x = a[i];
		const y = b[i];
		if (
			x.number !== y.number ||
			x.state !== y.state ||
			x.isDraft !== y.isDraft ||
			x.title !== y.title ||
			x.url !== y.url ||
			x.updatedAt !== y.updatedAt ||
			x.headRefName !== y.headRefName ||
			x.headOwner !== y.headOwner
		) {
			return false;
		}
	}
	return true;
}
