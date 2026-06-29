/**
 * Conventional Commits 提交信息校验（纯函数，可单测）。
 *
 * 规约：Conventional Commits 1.0.0。首行（subject）须形如
 *   `type(scope)!: description`
 * 其中 type ∈ 允许集合，scope 与 `!`（破坏性）可选，冒号后须有空格 + 非空描述。
 * 参考：https://www.conventionalcommits.org/zh-hans/v1.0.0/
 */

export type ConventionalSeverity = 'ok' | 'warning' | 'error';

export interface ConventionalValidation {
	readonly severity: ConventionalSeverity;
	readonly reason?: string;
}

const ALLOWED_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];
// scope 允许任意非括号非空白字符（含中文/Unicode）；Windows 行尾用 \r?\n 切分。
const SUBJECT_RE = new RegExp(`^(${ALLOWED_TYPES.join('|')})(\\([^()\\s]+\\))?(!)?: .+`);
const SUBJECT_MAX_LENGTH = 72;

export const ALLOWED_COMMIT_TYPES = ALLOWED_TYPES;

/**
 * 校验提交信息是否符合 Conventional Commits。
 * - error：阻断提交（空信息 / 首行格式不符）。
 * - warning：可提交但提示（主题过长等）。
 * - ok：通过。
 */
export function validateConventional(message: string): ConventionalValidation {
	const trimmed = message.trim();
	if (!trimmed) {
		return { severity: 'error', reason: '提交信息不能为空' };
	}
	const subject = message.split(/\r?\n/, 1)[0] ?? '';
	if (!subject.trim()) {
		return { severity: 'error', reason: '主题行（首行）不能为空' };
	}
	if (!SUBJECT_RE.test(subject)) {
		const allowed = ALLOWED_TYPES.join('/');
		return { severity: 'error', reason: `首行需形如 "type(scope): description"，type ∈ ${allowed}` };
	}
	if (subject.length > SUBJECT_MAX_LENGTH) {
		return { severity: 'warning', reason: `主题行 ${subject.length} 字符，建议 ≤ ${SUBJECT_MAX_LENGTH}` };
	}
	return { severity: 'ok' };
}
