import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
	// 功能性 EventEmitter mock：event 注册监听、fire 通知（供 rebind fire 断言）。
	EventEmitter: class {
		private listeners: Array<() => void> = [];
		get event() {
			return (l: () => void) => {
				this.listeners.push(l);
				return { dispose: () => { this.listeners = this.listeners.filter((x) => x !== l); } };
			};
		}
		fire(): void {
			for (const l of [...this.listeners]) {
				l();
			}
		}
		dispose(): void {
			this.listeners = [];
		}
	},
}));

import type { Memento } from 'vscode';
import { BranchFavorites } from '../../src/adapter/branch-favorites';

/** 内存 Memento（模拟 workspaceState 持久化往返）。 */
class MemMemento {
	private readonly map = new Map<string, unknown>();
	get<T>(key: string): T | undefined {
		return this.map.get(key) as T | undefined;
	}
	update(key: string, value: unknown): Thenable<void> {
		this.map.set(key, value);
		return Promise.resolve();
	}
}

function makeFavorites(repoRoot = '/repo'): { fav: BranchFavorites; memento: MemMemento } {
	const memento = new MemMemento();
	const fav = new BranchFavorites(memento as unknown as Memento, repoRoot);
	return { fav, memento };
}

describe('BranchFavorites', () => {
	it('初始为空', () => {
		const { fav } = makeFavorites();
		expect(fav.list()).toEqual([]);
		expect(fav.isFavorite('main')).toBe(false);
	});

	it('toggle 收藏并持久化（重建恢复）', () => {
		const { fav, memento } = makeFavorites();
		fav.toggle('main');
		expect(fav.isFavorite('main')).toBe(true);
		const fav2 = new BranchFavorites(memento as unknown as Memento, '/repo');
		expect(fav2.isFavorite('main')).toBe(true);
	});

	it('toggle 再点取消', () => {
		const { fav } = makeFavorites();
		fav.toggle('main');
		fav.toggle('main');
		expect(fav.isFavorite('main')).toBe(false);
	});

	it('setRepoRoot 切换后读到另一仓库的收藏（多根隔离，issue #107）', () => {
		const memento = new MemMemento();
		memento.update('hyperGit.branchFavorites:/repo-b', JSON.stringify(['dev', 'release']));
		const fav = new BranchFavorites(memento as unknown as Memento, '/repo-a');
		fav.toggle('main'); // repo-a 的收藏
		fav.setRepoRoot('/repo-b');
		expect(fav.list()).toEqual(['dev', 'release']);
		expect(fav.isFavorite('main')).toBe(false);
	});

	it('setRepoRoot 同 root 幂等（不 fire）', () => {
		const { fav } = makeFavorites();
		let fired = 0;
		fav.onDidChange(() => fired++);
		fav.setRepoRoot('/repo');
		expect(fired).toBe(0);
	});

	it('setRepoRoot 切换后 persist 写入新 key', () => {
		const { fav, memento } = makeFavorites('/repo-a');
		fav.setRepoRoot('/repo-b');
		fav.toggle('dev');
		expect(memento.get<string>('hyperGit.branchFavorites:/repo-b')).toBe(JSON.stringify(['dev']));
	});
});
