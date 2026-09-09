/**
 * Git ref 名（分支/标签）即时校验（纯函数，零 vscode 依赖）。
 *
 * 规则取 `git check-ref-format` 的 UI 相关子集：拦截明显非法输入并给出可行动提示，
 * 不追求与 git 完全一致（最终仲裁仍由 git 本身完成——过严会挡住合法 ref）。
 */

export type RefKind = 'branch' | 'tag' | 'any';

/** 校验 ref 名：合法返回 null，非法返回用户可读的英文提示（供 InputBox.validateInput 直用）。 */
export function validateRefName(name: string, kind: RefKind = 'any'): string | null {
	const v = name;
	if (!v.trim()) {
		return 'Name cannot be empty';
	}
	if (v !== v.trim()) {
		return 'Name cannot start or end with whitespace';
	}
	if (v.startsWith('-')) {
		return 'Name cannot start with "-" (it would be parsed as an option)';
	}
	if (v.endsWith('.')) {
		return 'Name cannot end with "."';
	}
	if (v.endsWith('.lock')) {
		return 'Name cannot end with ".lock"';
	}
	if (v.includes('..')) {
		return 'Name cannot contain ".."';
	}
	if (v.includes('@{')) {
		return 'Name cannot contain "@{"';
	}
	if (/[\s~^:?*[\\]/.test(v)) {
		return 'Name cannot contain whitespace or any of ~ ^ : ? * [ \\';
	}
	if (kind === 'tag' && v.includes('#')) {
		return 'Tag names cannot contain "#"';
	}
	if (v.startsWith('/') || v.endsWith('/')) {
		return 'Name cannot start or end with "/"';
	}
	if (v.includes('//')) {
		return 'Name cannot contain "//"';
	}
	if (v.split('/').some((part) => part.startsWith('.'))) {
		return 'Path components cannot start with "."';
	}
	if (v === '@') {
		return 'Name cannot be just "@"';
	}
	if (kind === 'branch' && v.toUpperCase() === 'HEAD') {
		return 'Branch cannot be named "HEAD"';
	}
	return null;
}
