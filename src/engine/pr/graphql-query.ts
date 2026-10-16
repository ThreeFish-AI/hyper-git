/**
 * Pull Request 列表查询的 GraphQL 构造（纯逻辑，零 vscode/网络依赖）。
 *
 * 按 UPDATED_AT 倒序拉取 OPEN/MERGED/CLOSED 全态 PR——分支徽标关心的是「每条远程分支
 * 最近的一条 PR」，而非某单一状态。`owner/name/after` 一律走 `$variables` 不插值（防注入，
 * 镜像 `engine/ci/graphql-query.ts`）；`first` 经整数区间校验后插值（GitHub 单页上限 100）。
 * 附带 `rateLimit{cost remaining resetAt}` 供 adapter 自适应限流冷却。
 */

/** buildPrQuery 入参。 */
export interface PrQueryInput {
	/** 单页条数（GitHub pullRequests 连接的 first 上限为 100）。 */
	readonly first: number;
	/** 分页游标（首页省略 / 传 null）。 */
	readonly after?: string | null;
}

/** buildPrQuery 产出。 */
export interface PrQueryOutput {
	readonly query: string;
}

/**
 * 构造 PR 列表查询文档。first 非整数 / ≤0 / >100、after 为空串时抛错（防御，杜绝畸形查询）。
 */
export function buildPrQuery(input: PrQueryInput): PrQueryOutput {
	const first = input.first;
	if (!Number.isInteger(first) || first <= 0 || first > 100) {
		throw new Error(`first 非法（须为 1~100 的整数）：${first}`);
	}
	if (input.after !== undefined && input.after !== null && input.after === '') {
		throw new Error('after 为空串（首页应省略或传 null）');
	}
	const query = `query BranchPullRequests($owner: String!, $name: String!, $after: String) {
  rateLimit { cost remaining resetAt }
  repository(owner: $owner, name: $name) {
    pullRequests(first: ${first}, states: [OPEN, MERGED, CLOSED], orderBy: {field: UPDATED_AT, direction: DESC}, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { number state isDraft title url updatedAt headRefName headRepositoryOwner { login } }
    }
  }
}`;
	return { query };
}
