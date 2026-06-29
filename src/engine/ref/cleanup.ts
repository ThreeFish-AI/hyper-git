/**
 * 已合并分支清理的纯逻辑（零 vscode 依赖）。
 *
 * 解析 `git branch --merged <base>` 输出并排除受保护分支（main/master/当前/指定 base），
 * 输出可安全删除的分支名列表。从 advanced-commands.cleanupBranches 内联逻辑提取，便于单测。
 */

/** 默认受保护（永不清理）的分支名。 */
export const PROTECTED_BRANCHES: readonly string[] = ['main', 'master'];

/** 判定分支是否受保护（默认集 + 额外排除项，如当前 HEAD / 指定 base）。 */
export function isProtectedBranch(name: string, extraExclude: readonly string[] = []): boolean {
	return PROTECTED_BRANCHES.includes(name) || extraExclude.includes(name);
}

/**
 * 解析 `git branch --merged/--no-merged` 输出为分支名列表（剥离 `*` 前缀、去空行、去重，保序）。
 * 不做受保护排除——仅做忠实解析，供 filterMergeable / partitionByMerged 复用。
 */
export function parseMergedBranchNames(mergedOutput: string): string[] {
	const seen = new Set<string>();
	const names: string[] = [];
	for (const raw of mergedOutput.split('\n')) {
		const name = raw.trim().replace(/^\*\s*/, '').trim();
		if (name.length === 0 || seen.has(name)) {
			continue;
		}
		seen.add(name);
		names.push(name);
	}
	return names;
}

/**
 * 解析 `git branch --merged <base>` 输出为可安全删除的分支名列表。
 * @param mergedOutput `git branch --merged` 原始输出（当前分支前缀 `*`）
 * @param base 比较基准分支名（排除自身）
 * @param extraExclude 额外排除的分支名（如当前 HEAD 名）
 */
export function filterMergeable(mergedOutput: string, base: string, extraExclude: readonly string[] = []): string[] {
	return parseMergedBranchNames(mergedOutput).filter((name) => !isProtectedBranch(name, [...extraExclude, base]));
}

/**
 * 按 `git branch --merged <base>` 输出，把选区分支分桶为「已合并 / 未合并」。
 * 与 filterMergeable 不同：不套用受保护排除（那是「是否可删」的谓词职责），仅做合并状态分类，
 * 供批量删除据此决定 force（未合并需 `-D`）与确认文案。
 * @param mergedOutput `git branch --merged` 原始输出
 * @param selection 选区分支短名（已由调用方完成本地/HEAD 过滤）
 */
export function partitionByMerged(
	mergedOutput: string,
	selection: readonly string[],
): { merged: string[]; unmerged: string[] } {
	const mergedSet = new Set(parseMergedBranchNames(mergedOutput));
	const merged: string[] = [];
	const unmerged: string[] = [];
	for (const name of selection) {
		(mergedSet.has(name) ? merged : unmerged).push(name);
	}
	return { merged, unmerged };
}

/** 名称列表内联展示：超过 max 个则截断并标注剩余数量，避免确认弹窗过长。 */
export function truncateNames(names: readonly string[], max = 8): string {
	if (names.length <= max) {
		return names.join(', ');
	}
	return `${names.slice(0, max).join(', ')} …还有 ${names.length - max} 个`;
}

/**
 * 生成批量删除本地分支的确认文案与确认按钮文本（纯逻辑）。
 * 诚实呈现强制删除风险：混合时分栏列出，确保 force 删除不被隐藏。
 * 单个目标保留原有针对性文案以维持既有体验。
 */
export function formatBranchDeleteConfirm(
	merged: readonly string[],
	unmerged: readonly string[],
): { detail: string; confirmLabel: string } {
	const total = merged.length + unmerged.length;
	if (total === 1) {
		const name = merged[0] ?? unmerged[0] ?? '';
		return merged.length === 1
			? { detail: `分支「${name}」已合并，可安全删除。`, confirmLabel: '删除' }
			: { detail: `分支「${name}」未合并，强制删除将丢失其独有提交！`, confirmLabel: '强制删除' };
	}
	if (unmerged.length === 0) {
		return { detail: `将删除 ${total} 个已合并的本地分支：${truncateNames(merged)}`, confirmLabel: '删除' };
	}
	if (merged.length === 0) {
		return {
			detail: `将强制删除 ${total} 个未合并的本地分支：${truncateNames(unmerged)}（将丢失它们的独有提交！）`,
			confirmLabel: '强制删除',
		};
	}
	const detail = [
		`将删除 ${total} 个本地分支：`,
		`· 已合并（安全删除）：${truncateNames(merged)}`,
		`· 未合并（强制删除，丢失提交）：${truncateNames(unmerged)}`,
	].join('\n');
	return { detail, confirmLabel: '全部删除' };
}
