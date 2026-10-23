import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
	// 构造路径仅触 setCtx（commands.executeCommand）；webview 未 resolve 时 pushState 早退，无需其余 API。
	commands: { executeCommand: vi.fn(() => Promise.resolve()) },
}));

import * as vscode from 'vscode';
import type { Memento } from 'vscode';
import type { GitRepositoryService } from '../../src/adapter/git-repository-service';
import type { GitHubCiService } from '../../src/adapter/ci/github-ci-service';
import type { AuthorTerm } from '../../src/engine/log/log-filter';
import { LogWebviewProvider } from '../../src/adapter/webview/log-webview';
import { parsePersistedFilter, type LogFilter } from '../../src/engine/log/log-filter';

/** 内存 Memento（模拟 workspaceState 持久化往返；update(key, undefined) 即删除条目，对齐 Memento 语义）。 */
class MemMemento {
	private readonly map = new Map<string, unknown>();
	get<T>(key: string): T | undefined {
		return this.map.get(key) as T | undefined;
	}
	update(key: string, value: unknown): Thenable<void> {
		if (value === undefined) {
			this.map.delete(key);
		} else {
			this.map.set(key, value);
		}
		return Promise.resolve();
	}
}

/** 功能型 EventEmitter mock（事件注册监听、fire 通知；branch-favorites.test.ts 同范式）。 */
class FakeEmitter<A> {
	private listeners: Array<(a: A) => void> = [];
	readonly event = (l: (a: A) => void): { dispose: () => void } => {
		this.listeners.push(l);
		return { dispose: () => { this.listeners = this.listeners.filter((x) => x !== l); } };
	};
	fire(a: A): void {
		for (const l of [...this.listeners]) {
			l(a);
		}
	}
}

/** fake service：可变 repoRoot + 可手动 fire 的两个生命周期事件。 */
function makeService(root: string | null) {
	const repoChanged = new FakeEmitter<{ previousRoot: string | null; root: string | null }>();
	const changed = new FakeEmitter<void>();
	const service = {
		repoRoot: root,
		onDidChange: changed.event,
		onDidChangeRepository: repoChanged.event,
		fireRepoChange(next: string | null): void {
			const previousRoot = this.repoRoot;
			this.repoRoot = next;
			repoChanged.fire({ previousRoot, root: next });
		},
	};
	return service;
}

const AUTHORS: readonly AuthorTerm[] = [
	{ kind: 'exact', name: 'ThreeFish', email: 'fish@example.com' },
	{ kind: 'pattern', pattern: '^bot' },
];

function makeProvider(root: string | null, memento: MemMemento): { provider: LogWebviewProvider; service: ReturnType<typeof makeService> } {
	const service = makeService(root);
	const provider = new LogWebviewProvider(
		service as unknown as GitRepositoryService,
		{} as GitHubCiService,
		memento as unknown as Memento,
	);
	return { provider, service };
}

describe('LogWebviewProvider authors 持久化', () => {
	it('构造期从 memento 恢复 authors', () => {
		const memento = new MemMemento();
		memento.update('hyperGit.log.authors:/repo-a', JSON.stringify(AUTHORS));
		const { provider } = makeProvider('/repo-a', memento);
		expect(provider.getFilter()).toEqual({ authors: AUTHORS });
		provider.dispose();
	});

	it('setFilter 持久化往返：同 memento 重建 provider 恢复', () => {
		const memento = new MemMemento();
		const { provider } = makeProvider('/repo-a', memento);
		provider.setFilter({ authors: AUTHORS, grep: 'x' });
		expect(memento.get('hyperGit.log.authors:/repo-a')).toBe(JSON.stringify(AUTHORS));
		provider.dispose();

		const { provider: revived } = makeProvider('/repo-a', memento);
		expect(revived.getFilter()).toEqual({ authors: AUTHORS, grep: 'x' });
		revived.dispose();
	});

	it('清除同样持久化：空选确认（authors: undefined）与 clearFilter 均删 key，重启不复活', () => {
		const memento = new MemMemento();
		const { provider } = makeProvider('/repo-a', memento);
		provider.setFilter({ ...provider.getFilter(), authors: AUTHORS });
		expect(memento.get('hyperGit.log.authors:/repo-a')).toBeDefined();
		provider.setFilter({ ...provider.getFilter(), authors: undefined });
		expect(memento.get('hyperGit.log.authors:/repo-a')).toBeUndefined();

		provider.setFilter({ authors: AUTHORS });
		provider.clearFilter();
		expect(memento.get('hyperGit.log.authors:/repo-a')).toBeUndefined();
		provider.dispose();
	});

	it('脏持久化数据免疫：视为未设置，不崩溃', () => {
		const memento = new MemMemento();
		memento.update('hyperGit.log.authors:/repo-a', 'not-json');
		const { provider } = makeProvider('/repo-a', memento);
		expect(provider.getFilter()).toEqual({});
		provider.dispose();
	});

	it('切库重绑：恢复新仓库完整持久过滤（authors + 非 authors 维度各自记忆）', () => {
		const memento = new MemMemento();
		memento.update('hyperGit.log.authors:/repo-b', JSON.stringify([{ kind: 'exact', name: 'B', email: 'b@x.com' }]));
		const { provider, service } = makeProvider('/repo-a', memento);
		provider.setFilter({ authors: AUTHORS, grep: 'stale' });

		service.fireRepoChange('/repo-b');
		expect(provider.getFilter()).toEqual({ authors: [{ kind: 'exact', name: 'B', email: 'b@x.com' }] });

		// 往返切回 A：恢复 A 的 authors 与 grep（各自 key 均按仓库存活）
		service.fireRepoChange('/repo-a');
		expect(provider.getFilter()).toEqual({ authors: AUTHORS, grep: 'stale' });
		provider.dispose();
	});

	it('repoRoot 为 null 时仅内存，不写 memento', () => {
		const memento = new MemMemento();
		const { provider } = makeProvider(null, memento);
		provider.setFilter({ authors: AUTHORS });
		expect(memento.get('hyperGit.log.authors:null')).toBeUndefined();
		expect(provider.getFilter()).toEqual({ authors: AUTHORS });
		provider.dispose();
	});
});

describe('LogWebviewProvider 非 authors 过滤维度持久化', () => {
	const DIMS: LogFilter = {
		path: 'src/a.ts',
		grep: 'fix',
		mergeMode: 'no-merge',
		dateFrom: new Date('2026-01-02T03:04:05.000Z'),
		messageRegex: '^feat:',
	};

	it('setFilter 全维度持久化往返：同 memento 重建 provider 恢复（Date 经 ISO 往返）', () => {
		const memento = new MemMemento();
		const { provider } = makeProvider('/repo-a', memento);
		provider.setFilter(DIMS);
		expect(memento.get('hyperGit.log.filter:/repo-a')).toBeDefined();
		provider.dispose();

		const { provider: revived } = makeProvider('/repo-a', memento);
		expect(revived.getFilter()).toEqual(DIMS);
		revived.dispose();
	});

	it('清除维度只删组合 key 中对应内容，authors key 独立存活', () => {
		const memento = new MemMemento();
		const { provider } = makeProvider('/repo-a', memento);
		provider.setFilter({ ...DIMS, authors: AUTHORS });
		// 空选确认（清 grep）：组合 key 仅剩其余维度，authors key 不动
		provider.setFilter({ ...provider.getFilter(), grep: undefined });
		expect(memento.get('hyperGit.log.authors:/repo-a')).toBe(JSON.stringify(AUTHORS));
		const revived0 = parsePersistedFilter(memento.get<string>('hyperGit.log.filter:/repo-a'));
		expect(revived0).toEqual({ path: DIMS.path, mergeMode: DIMS.mergeMode, dateFrom: DIMS.dateFrom, messageRegex: DIMS.messageRegex });

		// clearFilter：两 key 全删
		provider.clearFilter();
		expect(memento.get('hyperGit.log.filter:/repo-a')).toBeUndefined();
		expect(memento.get('hyperGit.log.authors:/repo-a')).toBeUndefined();
		provider.dispose();
	});

	it('切库恢复新仓库组合 key，与 authors 合并', () => {
		const memento = new MemMemento();
		memento.update('hyperGit.log.filter:/repo-b', JSON.stringify({ grep: 'bot', mergeMode: 'merge-only' }));
		memento.update('hyperGit.log.authors:/repo-b', JSON.stringify(AUTHORS));
		const { provider, service } = makeProvider('/repo-a', memento);
		provider.setFilter({ path: 'old.ts' });

		service.fireRepoChange('/repo-b');
		expect(provider.getFilter()).toEqual({ grep: 'bot', mergeMode: 'merge-only', authors: AUTHORS });
		provider.dispose();
	});

	it('脏组合数据免疫：视为未设置，不崩溃', () => {
		const memento = new MemMemento();
		memento.update('hyperGit.log.filter:/repo-a', 'not-json');
		memento.update('hyperGit.log.authors:/repo-a', JSON.stringify(AUTHORS));
		const { provider } = makeProvider('/repo-a', memento);
		expect(provider.getFilter()).toEqual({ authors: AUTHORS });
		provider.dispose();
	});
});

describe('LogWebviewProvider 过滤激活 context key（标题栏图标双命令互斥）', () => {
	it('setFilter / clearFilter 同步 hyperGit.log.filterActive', () => {
		const memento = new MemMemento();
		const { provider } = makeProvider('/repo-a', memento);
		const exec = vi.mocked(vscode.commands.executeCommand);
		exec.mockClear();

		provider.setFilter({ grep: 'fix' });
		expect(exec).toHaveBeenCalledWith('setContext', 'hyperGit.log.filterActive', true);
		exec.mockClear();
		provider.clearFilter();
		expect(exec).toHaveBeenCalledWith('setContext', 'hyperGit.log.filterActive', false);
		provider.dispose();
	});

	it('构造期恢复持久过滤即激活（重启后图标点亮）', () => {
		const memento = new MemMemento();
		memento.update('hyperGit.log.filter:/repo-a', JSON.stringify({ grep: 'fix' }));
		const { provider } = makeProvider('/repo-a', memento);
		expect(vi.mocked(vscode.commands.executeCommand)).toHaveBeenCalledWith('setContext', 'hyperGit.log.filterActive', true);
		provider.dispose();
	});

	it('切库重载按新仓库过滤态同步（B 无持久过滤 → false，往返切回 → true）', () => {
		const memento = new MemMemento();
		memento.update('hyperGit.log.filter:/repo-a', JSON.stringify({ grep: 'fix' }));
		const { provider, service } = makeProvider('/repo-a', memento);
		const exec = vi.mocked(vscode.commands.executeCommand);
		exec.mockClear();

		service.fireRepoChange('/repo-b');
		expect(exec).toHaveBeenCalledWith('setContext', 'hyperGit.log.filterActive', false);
		exec.mockClear();
		service.fireRepoChange('/repo-a');
		expect(exec).toHaveBeenCalledWith('setContext', 'hyperGit.log.filterActive', true);
		provider.dispose();
	});

	it('归一化未激活态不点亮：空串 / mergeMode all / 空 authors 恢复后仍为 false', () => {
		const memento = new MemMemento();
		const { provider } = makeProvider('/repo-a', memento);
		const exec = vi.mocked(vscode.commands.executeCommand);
		exec.mockClear();

		provider.setFilter({ path: '', mergeMode: 'all', authors: [] });
		expect(exec).toHaveBeenCalledWith('setContext', 'hyperGit.log.filterActive', false);
		provider.dispose();
	});
});
