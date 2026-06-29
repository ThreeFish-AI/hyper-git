/**
 * 三方合并（diff3）纯逻辑，零 vscode 依赖。
 *
 * 对齐 IDEA 3-way merge editor：给定 base / ours / theirs 三份文本（按行），产出 MergeHunk[]
 * （stable 一致段 / conflict 冲突段）。算法基于 LCS（最长公共子序列）求 base↔ours 与 base↔theirs
 * 的匹配锚点，锚点间的区域按 diff3 规则判定为一致或冲突。
 */

export type MergeHunk =
	| { readonly kind: 'stable'; readonly content: readonly string[] }
	| { readonly kind: 'conflict'; readonly base: readonly string[]; readonly ours: readonly string[]; readonly theirs: readonly string[] };

export type ResolveChoice = 'ours' | 'theirs' | 'both' | 'base' | 'manual';

/** 两序列的 LCS 匹配对（[aIdx, bIdx]，单调递增）。 */
function lcsMatches(a: readonly string[], b: readonly string[]): Array<[number, number]> {
	const n = a.length;
	const m = b.length;
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}
	const matches: Array<[number, number]> = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			matches.push([i, j]);
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			i++;
		} else {
			j++;
		}
	}
	return matches;
}

function eq(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	for (let k = 0; k < a.length; k++) {
		if (a[k] !== b[k]) {
			return false;
		}
	}
	return true;
}

/**
 * 三方合并：返回 MergeHunk[]。冲突判定遵循 diff3：仅当 ours 与 theirs 对同一 base 区域做了不同改动时冲突。
 */
export function diff3(base: readonly string[], ours: readonly string[], theirs: readonly string[]): MergeHunk[] {
	const mo = new Map<number, number>(); // baseIdx -> oursIdx
	for (const [oi, bi] of lcsMatches(ours, base)) {
		mo.set(bi, oi);
	}
	const mt = new Map<number, number>(); // baseIdx -> theirsIdx
	for (const [ti, bi] of lcsMatches(theirs, base)) {
		mt.set(bi, ti);
	}

	const hunks: MergeHunk[] = [];
	const pushStable = (content: readonly string[]): void => {
		if (content.length === 0) {
			return;
		}
		const last = hunks[hunks.length - 1];
		if (last && last.kind === 'stable') {
			// 合并相邻 stable 段，减少分段
			(hunks[hunks.length - 1] as { kind: 'stable'; content: string[] }).content.push(...content);
		} else {
			hunks.push({ kind: 'stable', content: [...content] });
		}
	};
	const emitRegion = (baseR: readonly string[], oursR: readonly string[], theirsR: readonly string[]): void => {
		if (baseR.length === 0 && oursR.length === 0 && theirsR.length === 0) {
			return;
		}
		const oursSame = eq(oursR, baseR);
		const theirsSame = eq(theirsR, baseR);
		if (oursSame && theirsSame) {
			pushStable(baseR);
		} else if (oursSame) {
			pushStable(theirsR); // theirs 改动，ours 未动 → 取 theirs
		} else if (theirsSame) {
			pushStable(oursR); // ours 改动，theirs 未动 → 取 ours
		} else if (eq(oursR, theirsR)) {
			pushStable(oursR); // 双方同样改动 → 取任一
		} else {
			hunks.push({ kind: 'conflict', base: baseR, ours: oursR, theirs: theirsR });
		}
	};

	let po = -1;
	let pb = -1;
	let pt = -1;
	for (let bi = 0; bi < base.length; bi++) {
		if (!mo.has(bi) || !mt.has(bi)) {
			continue;
		}
		const oi = mo.get(bi)!;
		const ti = mt.get(bi)!;
		emitRegion(base.slice(pb + 1, bi), ours.slice(po + 1, oi), theirs.slice(pt + 1, ti));
		pushStable([base[bi]]);
		po = oi;
		pb = bi;
		pt = ti;
	}
	emitRegion(base.slice(pb + 1), ours.slice(po + 1), theirs.slice(pt + 1));
	return hunks;
}

/** 解析单个 hunk 为最终行（stable 直接返回 content；conflict 按选择返回）。 */
export function resolveHunk(hunk: MergeHunk, choice: ResolveChoice, manual?: readonly string[]): string[] {
	if (hunk.kind === 'stable') {
		return [...hunk.content];
	}
	switch (choice) {
		case 'ours':
			return [...hunk.ours];
		case 'theirs':
			return [...hunk.theirs];
		case 'both':
			return [...hunk.ours, ...hunk.theirs];
		case 'base':
			return [...hunk.base];
		case 'manual':
			return manual ? [...manual] : [...hunk.ours];
	}
}

/** 统计冲突数。 */
export function conflictCount(hunks: readonly MergeHunk[]): number {
	return hunks.reduce((n, h) => (h.kind === 'conflict' ? n + 1 : n), 0);
}
