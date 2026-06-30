/**
 * CI 批量查询的 GraphQL 构造（纯逻辑，零 vscode/网络依赖）。
 *
 * 用别名（`c0: object(oid:…)`）在单次请求内拉取**多个**提交的 `statusCheckRollup`，避免
 * N 个提交 = N 次 REST 往返（Log 一页可达 1000 提交）。`owner/name` 走 `$variables` 不插值
 * （防注入）；oid 来自信任源（git log）但仍做 `/^[0-9a-f]{7,40}$/i` 防御性校验后再插值别名。
 */

/** oid 合法形态（git SHA-1：7~40 位十六进制）。非法 oid 直接抛错，杜绝构造畸形查询。 */
const OID_RE = /^[0-9a-f]{7,40}$/i;

/** 别名前缀（构造端与解析端共用此单一事实源，按序号映射回 oid）。 */
export const CI_ALIAS_PREFIX = 'c';

/** 每次查询拉取每个 commit 的 context 上限（极少 commit 超 50 项；超出按 total 已知、明细取首 50）。 */
export const DEFAULT_CONTEXTS_PER_COMMIT = 50;

/** buildCiQuery 入参。 */
export interface CiQueryInput {
	readonly owner: string;
	readonly name: string;
	/** 已去重、已切片至 ≤ 单次上限的 oid 列表。 */
	readonly oids: readonly string[];
	readonly contextsPerCommit?: number;
}

/** buildCiQuery 产出：查询串 + alias→oid 映射（解析端据序号回填 hash）。 */
export interface CiQueryOutput {
	readonly query: string;
	/** 第 i 个 alias 对应第 i 个 oid（与入参 oids 同序）。 */
	readonly aliases: readonly string[];
}

/**
 * 构造批量 GraphQL 文档。所有 oid 经 {@link OID_RE} 校验（防御性）；owner/name 不插值，
 * 经 `$variables` 传递。附带 `rateLimit{cost remaining resetAt}` 供 adapter 自适应限流冷却。
 */
export function buildCiQuery(input: CiQueryInput): CiQueryOutput {
	const first = input.contextsPerCommit ?? DEFAULT_CONTEXTS_PER_COMMIT;
	if (!Number.isInteger(first) || first <= 0) {
		throw new Error(`contextsPerCommit 非法：${first}`);
	}
	const oids = input.oids;
	if (oids.length === 0) {
		throw new Error('oids 为空');
	}
	const aliases: string[] = [];
	const fields: string[] = [];
	for (let i = 0; i < oids.length; i++) {
		const oid = oids[i];
		if (typeof oid !== 'string' || !OID_RE.test(oid)) {
			throw new Error(`非法 oid：${oid}`);
		}
		const alias = CI_ALIAS_PREFIX + i;
		aliases.push(alias);
		// oid 已校验为十六进制，安全插值。
		fields.push(`${alias}: object(oid: "${oid}") { ...CiCommitRollup }`);
	}
	const query = `query CiBatch($owner: String!, $name: String!) {
  rateLimit { cost remaining resetAt }
  repository(owner: $owner, name: $name) {
${fields.map((f) => '    ' + f).join('\n')}
  }
}
fragment CiCommitRollup on Commit {
  oid
  statusCheckRollup {
    state
    contexts(first: ${first}) {
      totalCount
      nodes {
        __typename
        ... on CheckRun { name status conclusion detailsUrl }
        ... on StatusContext { context state targetUrl description }
      }
    }
  }
}`;
	return { query, aliases };
}
