/**
 * 交互式 rebase todo 序列构造（纯逻辑，零 vscode 依赖）。
 *
 * 对齐 IDEA 交互式 rebase 编辑器：将 {action, hash, subject} 序列化为 git rebase -i 的 todo 文件内容，
 * 供 GIT_SEQUENCE_EDITOR 注入；并支持解析（回填编辑器）与重排序（拖拽）。
 * action 限定 pick / reword / edit / squash / fixup / drop。
 */

export type RebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';

export const REBASE_ACTIONS: readonly RebaseAction[] = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'];

export interface RebaseTodoItem {
	readonly action: RebaseAction;
	readonly hash: string;
	readonly subject: string;
}

/** 校验 action 合法（兼类型守卫）。 */
export function isValidAction(action: string): action is RebaseAction {
	return (REBASE_ACTIONS as readonly string[]).includes(action);
}

/** 序列化 todo 列表为 git rebase -i 的 todo 文件内容（每行 "action hash subject"，末尾换行）。 */
export function serializeTodo(items: readonly RebaseTodoItem[]): string {
	return items.map((i) => `${i.action} ${i.hash} ${i.subject}`).join('\n') + '\n';
}

/** 解析 todo 文件内容为 RebaseTodoItem[]（容错：跳过注释行/空行/非法 action）。 */
export function parseTodo(content: string): RebaseTodoItem[] {
	const items: RebaseTodoItem[] = [];
	for (const raw of content.split('\n')) {
		const line = raw.trim();
		if (line.length === 0 || line.startsWith('#')) {
			continue;
		}
		const m = line.match(/^(\w+)\s+(\S+)\s*(.*)$/);
		if (!m) {
			continue;
		}
		const [, action, hash, subject] = m;
		if (!isValidAction(action)) {
			continue;
		}
		items.push({ action, hash, subject });
	}
	return items;
}

/** 重排序：把 from 索引的项移动到 to 索引（不可变；越界或相同则原样返回副本）。 */
export function reorderTodo(items: readonly RebaseTodoItem[], from: number, to: number): RebaseTodoItem[] {
	if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) {
		return [...items];
	}
	const next = [...items];
	const [moved] = next.splice(from, 1);
	next.splice(to, 0, moved);
	return next;
}
