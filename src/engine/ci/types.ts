/**
 * CI 状态视图模型（纯逻辑，零 vscode/网络依赖）。
 *
 * 汇总 GitHub「Commit Status（旧）+ Check Runs（GitHub Actions）」为单一语义状态，
 * 供 Log 视图按提交渲染绿勾/红叉/运行中图标与悬停明细。状态语义（{@link CiState}）与展示
 * 解耦：引擎只产出归一化状态 + 原始 conclusion 文案，渲染器（webview）据 state 决定图标与主题色。
 */

/**
 * 提交的 CI 归一化状态：
 * - `success` 全部检查通过（含 NEUTRAL/SKIPPED 等非阻塞结论）；
 * - `failure` 至少一项失败（FAILURE/ERROR/TIMED_OUT/CANCELLED/ACTION_REQUIRED…）；
 * - `pending` 至少一项进行中且无失败（PENDING/EXPECTED/QUEUED/IN_PROGRESS…）；
 * - `unknown` 无 CI 配置 / 提交未推送到远程 / 非 Commit 对象（不渲染图标）。
 */
export type CiState = 'success' | 'failure' | 'pending' | 'unknown';

/** 单条检查项（一个 CheckRun 或一个 StatusContext）的视图模型。 */
export interface CiCheckVM {
	/** 检查名（CheckRun.name 或 StatusContext.context）。 */
	readonly name: string;
	/** 归一化状态 → 决定 Tooltip 内的图标。 */
	readonly state: CiState;
	/** 原始结论/状态文案（如 `TIMED_OUT` / `FAILURE`），供 Tooltip 直显，便于定位「未通过原因」。 */
	readonly conclusion?: string;
	/** 描述（StatusContext.description，外部 CI 常在此给出失败摘要）。 */
	readonly description?: string;
	/** 该检查的运行详情链接（CheckRun.detailsUrl / StatusContext.targetUrl）。 */
	readonly url?: string;
}

/** 单个提交的 CI 汇总。`state` 为权威图标状态（直接取自 GitHub rollup，覆盖全部 context）。 */
export interface CiStatusVM {
	readonly state: CiState;
	readonly checks: readonly CiCheckVM[];
	/** 已通过检查数（基于已取回的 checks 统计）。 */
	readonly passed: number;
	/** 检查总数（基于已取回的 checks 统计）。 */
	readonly total: number;
	/** 最佳跳转链接（优先首个失败项，其次首个有链接项）—— Tooltip「在 GitHub 查看」。 */
	readonly url?: string;
}
