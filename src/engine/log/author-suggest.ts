/**
 * 作者候选查询（Filter by Author 多选）：`git shortlog` 取数参数 + 输出解析（纯逻辑，零 vscode 依赖）。
 *
 * shortlog 在 git 侧完成聚合计数与降序排序（巨库 stdout 仅数百行，优于全量 `log --format` 逐行回传），
 * engine 仅保留一个容错解析函数；引用范围复用 {@link scopeRefs} 与 Graph 视图一致（单一事实源）。
 */

import { scopeRefs, type LogScope } from './log-query';

/** 作者统计（shortlog 一行：身份 + 提交数）。 */
export interface AuthorStat {
	readonly name: string;
	readonly email: string;
	readonly count: number;
}

/** shortlog 参数：`-s` 仅计数、`-n` 按数降序、`-e` 含 email；引用范围随 scope。
 * `current` 的 refs 为空时必须补显式 `HEAD`——shortlog 无 rev 时非 tty 下会等 stdin 而挂起。 */
export function buildAuthorListArgs(scope: LogScope): string[] {
	const refs = scopeRefs(scope);
	return ['-s', '-n', '-e', ...(refs.length > 0 ? refs : ['HEAD'])];
}

/** 解析 `git shortlog -se` 输出行（`<count>\t<Name> <email>`）；坏行/空输入容错跳过。
 * git ident 禁止 name/email 含 `<` `>` 或换行，`<email>` 段无切分歧义。 */
export function parseShortlog(output: string): AuthorStat[] {
	const stats: AuthorStat[] = [];
	for (const line of output.split('\n')) {
		const m = line.match(/^\s*(\d+)\t(.*) <([^<>]*)>\s*$/);
		if (m) {
			stats.push({ count: Number(m[1]), name: m[2], email: m[3] });
		}
	}
	return stats;
}
