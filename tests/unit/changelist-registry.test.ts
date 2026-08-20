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

	it('setRepoRoot 切换后读到另一仓库的数据（多根隔离，issue #107）', () => {
		const { reg } = makeRegistry('/repo-a');
		const id = reg.create('Feature A');
		reg.move('a.ts', id);

		const mementoB = new MemMemento();
		mementoB.update(
			'hyperGit.changelists:/repo-b',
			JSON.stringify({
				defs: [
					{ id: 'default', name: 'Default' },
					{ id: 'cl_b', name: 'Feature B' },
				],
				activeId: 'cl_b',
				assignments: { 'b.ts': 'cl_b' },
			}),
		);
		// 同一实例切到 repo-b：换 key 重载
		(reg as unknown as { workspaceState: Memento }).workspaceState = mementoB as unknown as Memento;
		reg.setRepoRoot('/repo-b');
		expect(reg.listDefs().map((d) => d.name)).toEqual(['Default', 'Feature B']);
		expect(reg.activeChangelistId).toBe('cl_b');
	});

	it('setRepoRoot 同 root 幂等（不 fire 不动状态）', () => {
		const { reg } = makeRegistry();
		let fired = 0;
		reg.onDidChange(() => fired++);
		reg.setRepoRoot('/repo');
		expect(fired).toBe(0);
	});

	it('setRepoRoot 切换后 fire onDidChange 并 persist 写入新 key', () => {
		const memento = new MemMemento();
		const reg = new ChangelistRegistry(memento as unknown as Memento, '/repo-a');
		let fired = 0;
		reg.onDidChange(() => fired++);
		reg.setRepoRoot('/repo-b');
		expect(fired).toBe(1);
		const id = reg.create('in B');
		const raw = memento.get<string>('hyperGit.changelists:/repo-b');
		expect(raw).toBeDefined();
		expect(JSON.parse(raw as string).defs.some((d: { name: string }) => d.name === 'in B')).toBe(true);
		expect(id).toBeTruthy();
	});
});
