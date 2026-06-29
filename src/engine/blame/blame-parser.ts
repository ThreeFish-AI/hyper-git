/**
 * `git blame --line-porcelain` 解析器（纯逻辑，零 vscode 依赖）。
 *
 * line-porcelain 格式：每行一个 header 块（首行 "<sha> <origLine> <finalLine> [groupCount]"），
 * 随后若干 "key value" 元数据（author / author-time / summary 等），以 "\t<原始行内容>" 结束。
 * 解析为每个最终行号 → BlameLine，供编辑器 gutter 注解（IDEA Annotate 等价）。
 */

export interface BlameLine {
	readonly line: number; // 1-based 最终行号
	readonly sha: string;
	readonly author: string;
	/** author-time（Unix 秒）。 */
	readonly authorTime: number;
	readonly summary: string;
}

const HEADER_RE = /^([0-9a-f]{7,40})\s+(\d+)\s+(\d+)(?:\s+(\d+))?$/;

/** 解析 `git blame --line-porcelain` 输出为 BlameLine[]（按最终行号）。 */
export function parseBlamePorcelain(output: string): BlameLine[] {
	const lines = output.split('\n');
	const result: BlameLine[] = [];
	// sha → 已知元数据缓存（porcelain 对同一 commit 后续块省略 author 等字段）
	const metaCache = new Map<string, { author: string; authorTime: number; summary: string }>();

	let i = 0;
	while (i < lines.length) {
		const m = lines[i].match(HEADER_RE);
		if (!m) {
			i++;
			continue;
		}
		const sha = m[1];
		const finalLine = Number(m[3]);
		i++;
		let author: string | undefined;
		let authorTime: number | undefined;
		let summary: string | undefined;
		// 读取元数据直到内容行（以 \t 起始）
		while (i < lines.length && !lines[i].startsWith('\t')) {
			const sp = lines[i].indexOf(' ');
			const key = sp < 0 ? lines[i] : lines[i].slice(0, sp);
			const val = sp < 0 ? '' : lines[i].slice(sp + 1);
			if (key === 'author') {
				author = val;
			} else if (key === 'author-time') {
				authorTime = Number(val);
			} else if (key === 'summary') {
				summary = val;
			}
			i++;
		}
		// 跳过内容行（\t...）
		if (i < lines.length && lines[i].startsWith('\t')) {
			i++;
		}
		const cached = metaCache.get(sha);
		const resolved = {
			author: author ?? cached?.author ?? '',
			authorTime: authorTime ?? cached?.authorTime ?? 0,
			summary: summary ?? cached?.summary ?? '',
		};
		metaCache.set(sha, resolved);
		result.push({ line: finalLine, sha, ...resolved });
	}
	return result;
}

/** 格式化注解短文本：`作者 · YYYY-MM-DD`（uncommitted 行 sha 全 0 → 显示「未提交」）。 */
export function formatAnnotation(b: BlameLine): string {
	if (/^0+$/.test(b.sha)) {
		return '未提交';
	}
	const d = new Date(b.authorTime * 1000);
	const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	return `${b.author} · ${date}`;
}
