/**
 * Git 错误文本提取的单一事实源（纯逻辑，零 vscode 依赖）。
 *
 * CLI 通道（{@link GitRepositoryService.execGit} 的约定）失败时把真实原因透传挂载在错误对象的
 * `.stderr`，`err.message` 只是 execFile 的通用串；vscode.git API 通道的 GitError 同样以 `.stderr`
 * 承载真实原因。本函数统一两条通道的提取语义：非空白 stderr 优先（trim 后返回），回退 message，
 * 最终 `String(e)` 兜底。新增代码与 engine 层分类一律引用本函数；存量 adapter 中尚有约 13 处
 * 只读 message 的旧式内联 `errMsg`（预先存在），待逐步迁移，禁止再新增内联拷贝。
 */

/**
 * 从 git 失败的拒绝值中提取最可读的错误文本。
 * @param e execGit / vscode.git API 抛出的错误（任意 unknown）
 * @returns 非空白 stderr（trim 后）＞ message ＞ String(e)
 */
export function gitErrorText(e: unknown): string {
	if (e && typeof e === 'object') {
		const ge = e as { stderr?: unknown; message?: unknown };
		if (typeof ge.stderr === 'string' && ge.stderr.trim()) {
			return ge.stderr.trim();
		}
		if (typeof ge.message === 'string' && ge.message) {
			return ge.message;
		}
	}
	return String(e);
}
