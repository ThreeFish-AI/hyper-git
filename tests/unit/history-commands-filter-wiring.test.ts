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
		showOpenDialog: vi.fn(),
		showInputBox: vi.fn(),
		showQuickPick: vi.fn(),
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

import * as vscode from 'vscode';
import type { Memento } from 'vscode';
import type { ChangeItem, GitRepositoryService } from '../../src/adapter/git-repository-service';
import type { GitHubCiService } from '../../src/adapter/ci/github-ci-service';
import type { AuthorTerm } from '../../src/engine/log/log-filter';
import { LogWebviewProvider } from '../../src/adapter/webview/log-webview';
import { registerHistoryCommands } from '../../src/adapter/history-commands';
import { CommitWebviewProvider } from '../../src/adapter/webview/commit-webview';
import { parsePersistedFilter } from '../../src/engine/log/log-filter';

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
		/** repo 跟随 repoRoot（logFilterPath 以 repo.rootUri 求相对路径）。 */
		get repo(): { rootUri: { fsPath: string } } | undefined {
			return this.repoRoot ? { rootUri: { fsPath: this.repoRoot } } : undefined;
		},
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
	/** 触发 logFilterPath：对话框挂起期间可注入事件（切库），再以所选文件路径放行。 */
	const filterPathWithDialog = (fsPath: string, during?: () => void) => {
		let resolveDialog!: (v: unknown) => void;
		vi.mocked(vscode.window.showOpenDialog).mockImplementationOnce(
			() => new Promise((r) => { resolveDialog = r; }),
		);
		const p = (h.handlers.get('hyperGit.logFilterPath') as () => Promise<void>)();
		during?.();
		resolveDialog([{ fsPath }]);
		return p;
	};
	return { provider, service, openPicker, showHistory, accept, filterPathWithDialog };
}

/** 触发任一「对话框型」命令/流程：对话框挂起期间可注入事件（切库），再以所选值放行。 */
function withPendingDialog(
	mockFn: { mockImplementationOnce: (impl: () => Promise<unknown>) => void },
	resolveValue: unknown,
	run: () => Promise<void>,
	during?: () => void,
): Promise<void> {
	let resolveDialog!: (v: unknown) => void;
	mockFn.mockImplementationOnce(() => new Promise((r) => { resolveDialog = r; }));
	const p = run();
	during?.();
	resolveDialog(resolveValue);
	return p;
}

/** commit 文件右键菜单（handleFileMenu 直调，绕过 webview 消息层）：getChanges 返回单个文件。 */
function makeCommitMenu(root: string) {
	const service = makeService(root);
	(service as unknown as { getChanges: () => unknown[] }).getChanges = () => [{ relativePath: 'src/a.ts' }];
	const provider = new CommitWebviewProvider(
		service as unknown as GitRepositoryService,
		{} as never,
		{} as never,
		new MemMemento() as unknown as Memento,
	);
	const menu = (path: string) =>
		(provider as unknown as { handleFileMenu: (p: string) => Promise<void> }).handleFileMenu(path);
	return { provider, service, menu };
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

	it('logFilterPath 正常路径：所选文件按当前仓库求相对路径，增量叠加不覆盖 authors', async () => {
		const memento = new MemMemento();
		memento.update('hyperGit.log.authors:/repo-a', JSON.stringify([FISH]));
		const { provider, filterPathWithDialog } = makeWiring('/repo-a', memento);

		await filterPathWithDialog('/repo-a/src/a.ts');
		expect(provider.getFilter()).toEqual({ authors: [FISH], path: 'src/a.ts' });
		provider.dispose();
	});

	it('重启往返后 showHistory 增量叠加：恢复的完整持久过滤（authors + grep）再叠 path', async () => {
		const memento = new MemMemento();
		memento.update('hyperGit.log.authors:/repo-a', JSON.stringify([FISH]));
		memento.update('hyperGit.log.filter:/repo-a', JSON.stringify({ grep: 'fix' }));
		const { provider, showHistory } = makeWiring('/repo-a', memento);

		await showHistory('src/a.ts');
		expect(provider.getFilter()).toEqual({ authors: [FISH], grep: 'fix', path: 'src/a.ts' });
		// path 随组合 key 一并持久化，重启后完整过滤存活
		expect(parsePersistedFilter(memento.get('hyperGit.log.filter:/repo-a'))).toEqual({ grep: 'fix', path: 'src/a.ts' });
		provider.dispose();
	});

	it('logFilterPath 切库守卫：对话框期间切库，不再按新仓库 root 求出跨仓库垃圾 path', async () => {
		const memento = new MemMemento();
		memento.update('hyperGit.log.authors:/repo-b', JSON.stringify([BOB]));
		const { provider, service, filterPathWithDialog } = makeWiring('/repo-a', memento);

		await filterPathWithDialog('/repo-a/src/a.ts', () => service.fireRepoChange('/repo-b'));
		// 无守卫时：path.relative('/repo-b', '/repo-a/src/a.ts') = '../repo-a/src/a.ts'（垃圾过滤）。
		expect(provider.getFilter()).toEqual({ authors: [BOB] });
		provider.dispose();
	});

	it('grep 正常路径：确认输入（含 trim）写入 filter 与组合 key', async () => {
		const memento = new MemMemento();
		const { provider } = makeWiring('/repo-a', memento);
		const grep = h.handlers.get('hyperGit.logFilterGrep') as () => Promise<void>;

		await withPendingDialog(vi.mocked(vscode.window.showInputBox), ' fix ', grep);
		expect(provider.getFilter()).toEqual({ grep: 'fix' });
		expect(parsePersistedFilter(memento.get('hyperGit.log.filter:/repo-a'))).toEqual({ grep: 'fix' });
		provider.dispose();
	});

	it('grep 切库守卫：输入框期间切库，确认不再把旧仓库输入写入新仓库持久化 key', async () => {
		const memento = new MemMemento();
		memento.update('hyperGit.log.authors:/repo-b', JSON.stringify([BOB]));
		const { provider, service } = makeWiring('/repo-a', memento);
		const grep = h.handlers.get('hyperGit.logFilterGrep') as () => Promise<void>;

		await withPendingDialog(vi.mocked(vscode.window.showInputBox), 'fix', grep, () => service.fireRepoChange('/repo-b'));
		expect(provider.getFilter()).toEqual({ authors: [BOB] });
		expect(memento.get('hyperGit.log.filter:/repo-b')).toBeUndefined();
		provider.dispose();
	});

	it('mergeMode 切库守卫：选择器期间切库，确认不写入任何仓库的持久化 key', async () => {
		const memento = new MemMemento();
		const { provider, service } = makeWiring('/repo-a', memento);
		const mergeMode = h.handlers.get('hyperGit.logFilterMergeMode') as () => Promise<void>;

		await withPendingDialog(
			vi.mocked(vscode.window.showQuickPick),
			{ label: 'Merge Commits Only', mode: 'merge-only' },
			mergeMode,
			() => service.fireRepoChange('/repo-b'),
		);
		expect(provider.getFilter()).toEqual({});
		expect(memento.get('hyperGit.log.filter:/repo-a')).toBeUndefined();
		expect(memento.get('hyperGit.log.filter:/repo-b')).toBeUndefined();
		provider.dispose();
	});

	it('commit 文件菜单切库守卫：菜单期间切库，不派发携带旧仓库 relativePath 的动作', async () => {
		const exec = vi.mocked(vscode.commands.executeCommand);
		exec.mockClear();
		const { provider, service, menu } = makeCommitMenu('/repo-a');

		await withPendingDialog(
			vi.mocked(vscode.window.showQuickPick),
			{ label: '$(history) Show History', command: 'hyperGit.showHistory' },
			() => menu('src/a.ts'),
			() => service.fireRepoChange('/repo-b'),
		);
		expect(exec).not.toHaveBeenCalledWith('hyperGit.showHistory', expect.anything());
		provider.dispose();
	});

	it('commit 文件菜单正常路径：确认后以原 change 派发所选命令', async () => {
		const exec = vi.mocked(vscode.commands.executeCommand);
		exec.mockClear();
		const { provider, menu } = makeCommitMenu('/repo-a');

		await withPendingDialog(
			vi.mocked(vscode.window.showQuickPick),
			{ label: '$(history) Show History', command: 'hyperGit.showHistory' },
			() => menu('src/a.ts'),
		);
		expect(exec).toHaveBeenCalledWith('hyperGit.showHistory', { relativePath: 'src/a.ts' });
		provider.dispose();
	});
});
