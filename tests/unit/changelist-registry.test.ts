import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
	EventEmitter: class {
		get event() {
			return () => ({ dispose: () => undefined });
		}
		fire() {}
		dispose() {}
	},
}));

import type { Memento } from 'vscode';
import { ChangelistRegistry } from '../../src/adapter/changelist-registry';

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

function makeRegistry(repoRoot = '/repo'): { reg: ChangelistRegistry; memento: MemMemento } {
	const memento = new MemMemento();
	const reg = new ChangelistRegistry(memento as unknown as Memento, repoRoot);
	return { reg, memento };
}

describe('ChangelistRegistry', () => {
	it('初始仅含 default（active）', () => {
		const { reg } = makeRegistry();
		expect(reg.listDefs().map((d) => d.id)).toEqual(['default']);
		expect(reg.activeChangelistId).toBe('default');
	});

	it('create 新增并持久化（重建恢复）', () => {
		const { reg, memento } = makeRegistry();
		const id = reg.create('Feature X');
		expect(reg.listDefs().some((d) => d.id === id && d.name === 'Feature X')).toBe(true);
		const reg2 = new ChangelistRegistry(memento as unknown as Memento, '/repo');
		expect(reg2.listDefs().some((d) => d.name === 'Feature X')).toBe(true);
	});

	it('setActive 切换活动列表', () => {
		const { reg } = makeRegistry();
		const id = reg.create('fx');
		reg.setActive(id);
		expect(reg.activeChangelistId).toBe(id);
	});

	it('rename：default 不可改名，其余可改', () => {
		const { reg } = makeRegistry();
		reg.rename('default', 'NewName');
		expect(reg.getDef('default')?.name).toBe('Default');
		const id = reg.create('fx');
		reg.rename(id, 'renamed');
		expect(reg.getDef(id)?.name).toBe('renamed');
	});

	it('remove：default 不可删；删除后文件重分配到 default，active 回退 default', () => {
		const { reg } = makeRegistry();
		reg.remove('default');
		expect(reg.listDefs().length).toBe(1);
		const id = reg.create('fx');
		reg.setActive(id);
		reg.move('a.ts', id);
		reg.remove(id);
		expect(reg.listDefs().some((d) => d.id === id)).toBe(false);
		expect(reg.activeChangelistId).toBe('default');
	});

	it('move 分配后 getGroups 按归属分组', () => {
		const { reg } = makeRegistry();
		const id = reg.create('fx');
		reg.move('a.ts', id);
		const groups = reg.getGroups([{ relativePath: 'a.ts' }] as const, (i) => i.relativePath);
		expect(groups.find((g) => g.id === id)?.items.length).toBe(1);
		expect(groups.find((g) => g.id === 'default')?.items.length).toBe(0);
	});

	it('损坏 JSON 容错回退默认', () => {
		const memento = new MemMemento();
		memento.update('hyperGit.changelists:/repo', '{ 损坏 JSON');
		const reg = new ChangelistRegistry(memento as unknown as Memento, '/repo');
		expect(reg.listDefs().map((d) => d.id)).toEqual(['default']);
		expect(reg.activeChangelistId).toBe('default');
	});
});
