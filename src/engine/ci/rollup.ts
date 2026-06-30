/**
 * CI 状态归一化与聚合（纯逻辑，零 vscode/网络依赖）。
 *
 * GitHub 一颗 commit 的 CI 由两类来源混合：**CheckRun**（GitHub Actions 等 Checks API）与
 * **StatusContext**（旧 Commit Status，外部 CI）。二者字段名不同（conclusion vs state），需归一为
 * 单一 {@link CiState} 供渲染。rollup 的 `state` 字段是 GitHub 已聚合好的「最终状态」，作为权威
 * 图标状态优先采用；明细项各自归一用于 Tooltip。
 */

import type { CiCheckVM, CiState, CiStatusVM } from './types';

/** rollup `state`（StatusState）→ {@link CiState}。EXPECTED 视为 pending（有待报告的检查）。 */
export function mapRollupState(state: string | null | undefined): CiState {
	if (!state) {
		return 'unknown';
	}
	switch (state) {
		case 'SUCCESS':
			return 'success';
		case 'FAILURE':
		case 'ERROR':
			return 'failure';
		case 'PENDING':
		case 'EXPECTED':
			return 'pending';
		default:
			return 'unknown';
	}
}

/**
 * CheckRun → {@link CiState}。未完成一律 pending；非阻塞结论（NEUTRAL/SKIPPED）算通过
 * （IDEA 语义：跳过的检查不视为失败）。
 */
export function checkRunState(status: string | null | undefined, conclusion: string | null | undefined): CiState {
	// 未完成（QUEUED/IN_PROGRESS/WAITING/PENDING/REQUESTED/null）一律 pending。
	if (status !== 'COMPLETED') {
		return 'pending';
	}
	switch (conclusion ?? null) {
		case 'SUCCESS':
		case 'NEUTRAL':
		case 'SKIPPED':
			return 'success';
		case 'FAILURE':
		case 'ERROR':
		case 'CANCELLED':
		case 'TIMED_OUT':
		case 'ACTION_REQUIRED':
		case 'STARTUP_FAILURE':
		case 'STALE':
			return 'failure';
		default:
			// COMPLETED 但结论缺失/未知：保守视为运行中。
			return 'pending';
	}
}

/** StatusContext → {@link CiState}（复用 rollup 映射）。 */
export function statusContextState(state: string | null | undefined): CiState {
	return mapRollupState(state);
}

/** 选择 Tooltip 的最佳跳转链接：首个失败项 → 否则首个有链接项 → 否则 undefined。 */
export function pickPrimaryUrl(checks: readonly CiCheckVM[]): string | undefined {
	const failed = checks.find((c) => c.state === 'failure' && c.url);
	if (failed?.url) {
		return failed.url;
	}
	return checks.find((c) => c.url)?.url;
}

/** 权威状态缺失时据已归一明细兜底重算（任一 failure→failure；任一 pending→pending；全通过→success）。 */
export function recomputeState(checks: readonly CiCheckVM[]): CiState {
	if (checks.length === 0) {
		return 'unknown';
	}
	if (checks.some((c) => c.state === 'failure')) {
		return 'failure';
	}
	if (checks.some((c) => c.state === 'pending')) {
		return 'pending';
	}
	return 'success';
}

/**
 * 汇总已归一明细为 {@link CiStatusVM}。`rollupState` 为权威图标状态；若为 unknown 但存在明细，
 * 则用 {@link recomputeState} 兜底（防御性，应对个别 rollup 缺失）。
 */
export function aggregateChecks(rollupState: CiState, checks: readonly CiCheckVM[]): CiStatusVM {
	const state = rollupState !== 'unknown' ? rollupState : recomputeState(checks);
	return {
		state,
		checks,
		passed: checks.filter((c) => c.state === 'success').length,
		total: checks.length,
		url: pickPrimaryUrl(checks),
	};
}
