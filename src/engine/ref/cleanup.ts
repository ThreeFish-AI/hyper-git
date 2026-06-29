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
 * 解析 `git branch --merged <base>` 输出为可安全删除的分支名列表。
 * @param mergedOutput `git branch --merged` 原始输出（当前分支前缀 `*`）
 * @param base 比较基准分支名（排除自身）
 * @param extraExclude 额外排除的分支名（如当前 HEAD 名）
 */
export function filterMergeable(mergedOutput: string, base: string, extraExclude: readonly string[] = []): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of mergedOutput.split('\n')) {
		const name = raw.trim().replace(/^\*\s*/, '').trim();
		if (name.length === 0 || seen.has(name)) {
			continue;
		}
		seen.add(name);
		if (isProtectedBranch(name, [...extraExclude, base])) {
			continue;
		}
		result.push(name);
	}
	return result;
}
