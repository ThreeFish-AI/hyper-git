/**
 * Pull Request 视图模型（engine 纯逻辑，零 vscode 依赖）。
 *
 * 状态与展示解耦（同 `engine/ci/types.ts` 的 CiStatusVM 范式）：本模块只承载 GitHub
 * PullRequestState 的归一事实；图标/配色/文案由渲染层（branches-tree）依据 state/isDraft 决定。
 */

/** GitHub PullRequestState 原样透传；未知值在解析端丢弃（`model.ts`）。 */
export type PrState = 'OPEN' | 'MERGED' | 'CLOSED';

/** 单条 PR 的视图模型。 */
export interface PullRequestVM {
	readonly number: number;
	readonly state: PrState;
	/** 草稿（state=OPEN 且 isDraft）→ 展示层弱化配色与 Draft 文案。 */
	readonly isDraft: boolean;
	readonly title: string;
	/** 浏览器端 PR 页链接（适配层经主机白名单校验后才入 Tooltip）。 */
	readonly url: string;
	/** ISO 8601（GitHub 原样）；同一 headRefName 多条 PR 时按此取最近。 */
	readonly updatedAt: string;
	/** head 分支名（head 仓库内，不含 owner 前缀）。 */
	readonly headRefName: string;
	/** head 仓库 owner login；fork 元数据缺失（null）→ ''（不参与 fork 全名匹配）。 */
	readonly headOwner: string;
	/** head 仓库名；fork 惯例保留 base 名（Tier a 身份校验的 repo 维度，缺失 → ''）。 */
	readonly headRepo: string;
}
