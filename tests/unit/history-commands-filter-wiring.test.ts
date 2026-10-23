import { describe, it, expect, vi } from 'vitest';

/** 命令 handler 注册表 + 可脚本化 QuickPick（pickAuthors 全交互在此驱动，不依赖真实 quick input）。 */
const h = vi.hoisted(() => ({
	handlers: new Map<string, (arg?: unknown) => unknown>(),
	qpListeners: new Map<string, (...args: unknown[]) => void>(),
	qp: undefined as { selectedItems: unknown[] } | undefined,
}));

vi.mock('vscode', () => ({
	commands: {
		registerCommand: vi.fn((id: string, handler: (arg?: unknown) => unknown) => {
			h.handlers.set(id, handler);
			return { dispose: () => undefined };
		}),
		executeCommand: vi.fn(() => Promise.resolve()),
	},
	window: {
		createQuickPick: () => {
			const qp = {
				canSelectMany: false,
				matchOnDescription: false,
				matchOnDetail: false,
				title: '',
				placeholder: '',
				busy: false,
				items: [] as unknown[],
				selectedItems: [] as unknown[],
				value: '',
				show: () => undefined,
				dispose: () => undefined,
				onDidChangeValue: (cb: (...args: unknown[]) => void) => {
					h.qpListeners.set('value', cb);
					return { dispose: () => undefined };
				},
				onDidChangeSelection: (cb: (...args: unknown[]) => void) => {
					h.qpListeners.set('selection', cb);
					return { dispose: () => undefined };
				},
				onDidAccept: (cb: (...args: unknown[]) => void) => {
					h.qpListeners.set('accept', cb);
					return { dispose: () => undefined };
				},
				onDidHide: (cb: (...args: unknown[]) => void) => {
					h.qpListeners.set('hide', cb);
					return { dispose: () => undefined };
				},
			};
			h.qp = qp;
			return qp;
		},
	},
}));

import type { Memento } from 'vscode';
import type { ChangeItem, GitRepositoryService } from '../../src/adapter/git-repository-service';
import type { GitHubCiService } from '../../src/adapter/ci/github-ci-service';
import type { AuthorTerm } from '../../src/engine/log/log-filter';
import { LogWebviewProvider } from '../../src/adapter/webview/log-webview';
import { registerHistoryCommands } from '../../src/adapter/history-commands';

/** 内存 Memento（对齐 workspaceState 语义：update(key, undefined) 即删除条目）。 */
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

/** 功能型 EventEmitter mock（branch-favorites.test.ts 同范式）。 */
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

/** fake service：可变 repoRoot + shortlog 空结果 + 可手动 fire 的生命周期事件。 */
function makeService(root: string | null) {
	const repoChanged = new FakeEmitter<{ previousRoot: string | null; root: string | null }>();
	const changed = new FakeEmitter<void>();
	const service = {
		repoRoot: root,
		execGit: async () => '',
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

const FISH: AuthorTerm = { kind: 'exact', name: 'ThreeFish', email: 'fish@example.com' };
const BOB: AuthorTerm = { kind: 'exact', name: 'Bob', email: 'bob@example.com' };

/** 真实 Provider（持久化真链路）+ 注册全部命令，返回触发入口。 */
function makeWiring(root: string, memento: MemMemento) {
	const service = makeService(root);
	const provider = new LogWebviewProvider(
		service as unknown as GitRepositoryService,
		{} as GitHubCiService,
		memento as unknown as Memento,
	);
	registerHistoryCommands(
		service as unknown as GitRepositoryService,
		provider,
		{} as never,
		{} as never,
	);
	const openPicker = () => (h.handlers.get('hyperGit.logFilterAuthor') as () => Promise<void>)();
	const showHistory = (relativePath: string) =>
		(h.handlers.get('hyperGit.showHistory') as (c?: ChangeItem) => Promise<void>)(
			{ relativePath } as unknown as ChangeItem,
		);
	const accept = (items: readonly { term: AuthorTerm }[]) => {
		// selectedItems 由 onDidAccept 闭包读取（() => settle(qp.selectedItems.map(...))），
		// 真实 quick input 由框架维护该字段，此处先注入再触发 accept。
		h.qp!.selectedItems = [...items];
		h.qpListeners.get('accept')!();
	};
	return { provider, service, openPicker, showHistory, accept };
}

describe('history-commands 过滤 wiring（真实 Provider 持久化链路）', () => {
	it('showHistory 增量式：保留持久化 authors 并叠加 path，不删 memento key', async () => {
		const memento = new MemMemento();
		memento.update('hyperGit.log.authors:/repo-a', JSON.stringify([FISH]));
		const { provider, showHistory } = makeWiring('/repo-a', memento);

		await showHistory('src/a.ts');
		expect(provider.getFilter()).toEqual({ authors: [FISH], path: 'src/a.ts' });
		expect(memento.get('hyperGit.log.authors:/repo-a')).toBe(JSON.stringify([FISH]));
		provider.dispose();
	});

	it('pickAuthors 正常路径：确认勾选写入 filter 与持久化 key', async () => {
		const memento = new MemMemento();
		const { provider, openPicker, accept } = makeWiring('/repo-a', memento);

		await openPicker();
		accept([{ term: FISH }]);
		expect(provider.getFilter()).toEqual({ authors: [FISH] });
		expect(memento.get('hyperGit.log.authors:/repo-a')).toBe(JSON.stringify([FISH]));
		provider.dispose();
	});

	it('pickAuthors settle 切库守卫：取数完成后切库，确认不再把旧仓库勾选误写新仓库 key', async () => {
		const memento = new MemMemento();
		memento.update('hyperGit.log.authors:/repo-b', JSON.stringify([BOB]));
		const { provider, service, openPicker, accept } = makeWiring('/repo-a', memento);

		await openPicker();
		// 取数守卫已通过（await 完成）；此后环境驱动切库（不夺焦点、QuickPick 仍开着）再确认。
		service.fireRepoChange('/repo-b');
		accept([{ term: FISH }]);
		expect(provider.getFilter()).toEqual({ authors: [BOB] });
		expect(memento.get('hyperGit.log.authors:/repo-b')).toBe(JSON.stringify([BOB]));
		provider.dispose();
	});
});
