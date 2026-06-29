import { describe, it, expect } from 'vitest';
import { toggleFavorite, isFavorite } from '../../src/engine/ref/favorites';

describe('favorites', () => {
	it('toggleFavorite 添加未收藏的分支', () => {
		expect(toggleFavorite([], 'main')).toEqual(['main']);
	});

	it('toggleFavorite 移除已收藏的分支', () => {
		expect(toggleFavorite(['main', 'dev'], 'main')).toEqual(['dev']);
	});

	it('double-toggle 回到原状（幂等）', () => {
		const a = toggleFavorite([], 'x');
		const b = toggleFavorite(a, 'x');
		expect(b).toEqual([]);
	});

	it('保持插入顺序，Set 去重', () => {
		let names: string[] = [];
		names = toggleFavorite(names, 'a');
		names = toggleFavorite(names, 'b');
		names = toggleFavorite(names, 'c');
		expect(names).toEqual(['a', 'b', 'c']); // 插入顺序
		names = toggleFavorite(names, 'a'); // 移除 a
		expect(names).toEqual(['b', 'c']);
		names = toggleFavorite(names, 'a'); // 重新加 a，置于末尾
		expect(names).toEqual(['b', 'c', 'a']);
	});

	it('空名不操作', () => {
		expect(toggleFavorite(['main'], '')).toEqual(['main']);
	});

	it('isFavorite 正确判定', () => {
		const names = ['main', 'dev'];
		expect(isFavorite(names, 'main')).toBe(true);
		expect(isFavorite(names, 'feature')).toBe(false);
	});
});
