/**
 * Commit trailer 构造（纯逻辑，零 vscode 依赖）。
 *
 * 对齐 IDEA/Conventional Commits 的 Co-authored-by trailer 追加，以及 --author 参数值格式化。
 * trailer 与 message body 之间需空行分隔；重复 trailer 不重复追加。
 */

/** 追加 Co-authored-by trailer（若已存在则原样返回，避免重复）。 */
export function appendCoAuthoredBy(message: string, name: string, email: string): string {
	const trailer = `Co-authored-by: ${name} <${email}>`;
	const trimmed = message.replace(/\s+$/, '');
	if (trimmed.length === 0) {
		return trailer;
	}
	if (trimmed.includes(trailer)) {
		return trimmed;
	}
	const lines = trimmed.split('\n');
	const lastLine = lines[lines.length - 1] ?? '';
	const lastTrailerLike = /^[A-Za-z0-9_-]+: .+/.test(lastLine);
	// 仅当末行已是 trailer 格式「且」其前一行为空（即已存在 trailer 块）时，直接换行追加；
	// 否则用空行分隔（避免把 Conventional Commits 单行 subject「feat: x」误判为 trailer）。
	const hasTrailerBlock = lastTrailerLike && lines.length >= 2 && lines[lines.length - 2] === '';
	return hasTrailerBlock ? `${trimmed}\n${trailer}` : `${trimmed}\n\n${trailer}`;
}

/** 格式化 --author 参数值：`Name <email>`。 */
export function authorArg(name: string, email: string): string {
	return `${name} <${email}>`;
}
