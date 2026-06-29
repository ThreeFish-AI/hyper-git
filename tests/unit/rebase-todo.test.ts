import { describe, it, expect } from 'vitest';
import {
	serializeTodo,
	parseTodo,
	reorderTodo,
	isValidAction,
	REBASE_ACTIONS,
	type RebaseTodoItem,
} from '../../src/engine/rebase/todo';

const ITEMS: RebaseTodoItem[] = [
	{ action: 'pick', hash: 'aaa1111', subject: 'first' },
	{ action: 'reword', hash: 'bbb2222', subject: 'second' },
	{ action: 'drop', hash: 'ccc3333', subject: 'third' },
];

describe('rebase todo', () => {
	it('REBASE_ACTIONS 含全部 6 种合法动作', () => {
		expect(REBASE_ACTIONS).toEqual(['pick', 'reword', 'edit', 'squash', 'fixup', 'drop']);
	});

	it('isValidAction 判定合法/非法', () => {
		expect(isValidAction('pick')).toBe(true);
		expect(isValidAction('squash')).toBe(true);
		expect(isValidAction('merge')).toBe(false);
		expect(isValidAction('')).toBe(false);
	});

	it('serializeTodo 产出 "action hash subject" 行（末尾换行）', () => {
		expect(serializeTodo(ITEMS)).toBe('pick aaa1111 first\nreword bbb2222 second\ndrop ccc3333 third\n');
	});

	it('serializeTodo 空列表产出单个换行', () => {
		expect(serializeTodo([])).toBe('\n');
	});

	it('parseTodo 跳过注释行/空行/非法 action', () => {
		const content = [
			'# Rebase comment',
			'',
			'pick aaa1111 first',
			'invalid zzz zzz',
			'reword bbb2222 second',
		].join('\n');
		const parsed = parseTodo(content);
		expect(parsed).toHaveLength(2);
		expect(parsed[0]).toEqual({ action: 'pick', hash: 'aaa1111', subject: 'first' });
		expect(parsed[1].action).toBe('reword');
	});

	it('parseTodo 与 serializeTodo 可往返（合法项）', () => {
		const text = serializeTodo(ITEMS);
		expect(parseTodo(text)).toEqual(ITEMS);
	});

	it('reorderTodo 把 from 移到 to', () => {
		const moved = reorderTodo(ITEMS, 2, 0);
		expect(moved.map((i) => i.hash)).toEqual(['ccc3333', 'aaa1111', 'bbb2222']);
	});

	it('reorderTodo 越界/相同索引返回副本', () => {
		expect(reorderTodo(ITEMS, 0, 0)).toEqual(ITEMS);
		expect(reorderTodo(ITEMS, -1, 0)).toEqual(ITEMS);
		expect(reorderTodo(ITEMS, 0, 99)).toEqual(ITEMS);
	});
});
