import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
	// 构造路径仅触 setCtx（commands.executeCommand）；webview 未 resolve 时 pushState 早退，无需其余 API。
	commands: { executeCommand: vi.fn(() => Promise.resolve()) },
}));

import type { Memento } from 'vscode';
import type { GitRepositoryService } from '../../src/adapter/git-repository-service';
import type { GitHubCiService } from '../../src/adapter/ci/github-ci-service';
import type { AuthorTerm } from '../../src/engine/log/log-filter';
import { LogWebviewProvider } from '../../src/adapter/webview/log-webview';

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
		expect(revived.getFilter()).toEqual({ authors: AUTHORS });
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

	it('切库重绑：非持久维度清空，authors 恢复新仓库持久值', () => {
		const memento = new MemMemento();
		memento.update('hyperGit.log.authors:/repo-b', JSON.stringify([{ kind: 'exact', name: 'B', email: 'b@x.com' }]));
		const { provider, service } = makeProvider('/repo-a', memento);
		provider.setFilter({ authors: AUTHORS, grep: 'stale' });

		service.fireRepoChange('/repo-b');
		expect(provider.getFilter()).toEqual({ authors: [{ kind: 'exact', name: 'B', email: 'b@x.com' }] });

		// 往返切回 A：恢复 A 的 authors
		service.fireRepoChange('/repo-a');
		expect(provider.getFilter()).toEqual({ authors: AUTHORS });
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
