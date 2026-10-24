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
		showWarningMessage: vi.fn(),
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

	it('pickAuthors 候选集外的持久化 exact 作者：ghost 项预勾选，no-op 确认不丢持久化数据', async () => {
		const memento = new MemMemento();
		memento.update('hyperGit.log.authors:/repo-a', JSON.stringify([FISH]));
		const { provider, openPicker, accept } = makeWiring('/repo-a', memento);

		// shortlog 恒返回空（service.execGit → ''）→ FISH 不在候选集，须以 ghost 项呈现且预勾选。
		await openPicker();
		const items = h.qp!.items as ReadonlyArray<{ term: AuthorTerm; description?: string }>;
		const ghost = items.find((i) => i.term.kind === 'exact' && i.term.email === FISH.email);
		expect(ghost).toBeDefined();
		expect(ghost!.description).toBe('not in current scope');
		expect((h.qp!.selectedItems as ReadonlyArray<{ term: AuthorTerm }>).some((i) => i.term === ghost!.term)).toBe(true);

		// no-op 确认（按当前预勾选原样 settle）不丢持久化 authors。
		accept(h.qp!.selectedItems as ReadonlyArray<{ term: AuthorTerm }>);
		expect(provider.getFilter()).toEqual({ authors: [FISH] });
		expect(memento.get('hyperGit.log.authors:/repo-a')).toBe(JSON.stringify([FISH]));
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

	it('logFilterPath 越仓守卫：所选文件在当前仓库外，告警放弃，不写内存与持久化 key', async () => {
		const memento = new MemMemento();
		const { provider, filterPathWithDialog } = makeWiring('/repo-a', memento);
		const warn = vi.mocked(vscode.window.showWarningMessage);
		warn.mockClear();

		// path.relative('/repo-a', '/outside/src/a.ts') = '../outside/src/a.ts'（越仓垃圾 path）。
		await filterPathWithDialog('/outside/src/a.ts');
		expect(provider.getFilter()).toEqual({});
		expect(memento.get('hyperGit.log.filter:/repo-a')).toBeUndefined();
		expect(warn).toHaveBeenCalledWith('This file is outside the current repository; cannot filter by path');
		provider.dispose();
	});

	it('logFilterPath 仓内 .. 前缀文件不误杀：按路径段判定越仓，仅 ../ 前缀拒绝', async () => {
		const memento = new MemMemento();
		const { provider, filterPathWithDialog } = makeWiring('/repo-a', memento);
		const warn = vi.mocked(vscode.window.showWarningMessage);
		warn.mockClear();

		// '..drafts/note.md' 是仓内合法文件名（'..' 仅作前缀，非路径段），应正常写入 path 过滤。
		await filterPathWithDialog('/repo-a/..drafts/note.md');
		expect(provider.getFilter()).toEqual({ path: '..drafts/note.md' });
		expect(memento.get('hyperGit.log.filter:/repo-a')).toBe(JSON.stringify({ path: '..drafts/note.md' }));
		expect(warn).not.toHaveBeenCalled();
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

	it('mergeMode 正常路径：选择 merge-only 写入 filter 与组合 key', async () => {
		const memento = new MemMemento();
		const { provider } = makeWiring('/repo-a', memento);
		const mergeMode = h.handlers.get('hyperGit.logFilterMergeMode') as () => Promise<void>;

		await withPendingDialog(
			vi.mocked(vscode.window.showQuickPick),
			{ label: 'Merge Commits Only', mode: 'merge-only' },
			mergeMode,
		);
		expect(provider.getFilter()).toEqual({ mergeMode: 'merge-only' });
		expect(parsePersistedFilter(memento.get('hyperGit.log.filter:/repo-a'))).toEqual({ mergeMode: 'merge-only' });
		provider.dispose();
	});

	it('date 正常路径：Last 7 Days 写入 dateFrom ≈ now-7d 并经组合 key ISO 往返', async () => {
		const memento = new MemMemento();
		const { provider } = makeWiring('/repo-a', memento);
		const date = h.handlers.get('hyperGit.logFilterDate') as () => Promise<void>;

		const t0 = Date.now();
		await withPendingDialog(vi.mocked(vscode.window.showQuickPick), { label: 'Last 7 Days', days: 7 }, date);
		const t1 = Date.now();
		const f = provider.getFilter();
		expect(f.dateFrom).toBeInstanceOf(Date);
		// handler 内部捕获的 now ∈ [t0, t1]（同 tick 执行时取等号），dateFrom = now - 7d。
		expect(f.dateFrom!.getTime()).toBeGreaterThanOrEqual(t0 - 7 * 86_400_000);
		expect(f.dateFrom!.getTime()).toBeLessThanOrEqual(t1 - 7 * 86_400_000);
		expect(parsePersistedFilter(memento.get('hyperGit.log.filter:/repo-a'))).toEqual({ dateFrom: f.dateFrom });
		provider.dispose();
	});

	it('date 清除分支：Clear Date Filter 移除 dateFrom 并删组合 key', async () => {
		const memento = new MemMemento();
		const { provider } = makeWiring('/repo-a', memento);
		const date = h.handlers.get('hyperGit.logFilterDate') as () => Promise<void>;
		provider.setFilter({ ...provider.getFilter(), dateFrom: new Date('2026-01-01T00:00:00.000Z') });
		expect(memento.get('hyperGit.log.filter:/repo-a')).toBeDefined();

		await withPendingDialog(vi.mocked(vscode.window.showQuickPick), { label: 'Clear Date Filter', days: 0 }, date);
		expect(provider.getFilter()).toEqual({});
		expect(memento.get('hyperGit.log.filter:/repo-a')).toBeUndefined();
		provider.dispose();
	});

	it('date 切库守卫：选择器期间切库，确认不写入任何仓库的持久化 key', async () => {
		const memento = new MemMemento();
		const { provider, service } = makeWiring('/repo-a', memento);
		const date = h.handlers.get('hyperGit.logFilterDate') as () => Promise<void>;

		await withPendingDialog(
			vi.mocked(vscode.window.showQuickPick),
			{ label: 'Last 7 Days', days: 7 },
			date,
			() => service.fireRepoChange('/repo-b'),
		);
		expect(provider.getFilter()).toEqual({});
		expect(memento.get('hyperGit.log.filter:/repo-a')).toBeUndefined();
		expect(memento.get('hyperGit.log.filter:/repo-b')).toBeUndefined();
		provider.dispose();
	});

	it('regex 正常路径：确认输入（含 trim）写入 filter 与组合 key', async () => {
		const memento = new MemMemento();
		const { provider } = makeWiring('/repo-a', memento);
		const regex = h.handlers.get('hyperGit.logFilterRegex') as () => Promise<void>;

		await withPendingDialog(vi.mocked(vscode.window.showInputBox), ' ^feat: ', regex);
		expect(provider.getFilter()).toEqual({ messageRegex: '^feat:' });
		expect(parsePersistedFilter(memento.get('hyperGit.log.filter:/repo-a'))).toEqual({ messageRegex: '^feat:' });
		provider.dispose();
	});

	it('regex 清除分支：空输入确认移除 messageRegex 并删组合 key', async () => {
		const memento = new MemMemento();
		const { provider } = makeWiring('/repo-a', memento);
		const regex = h.handlers.get('hyperGit.logFilterRegex') as () => Promise<void>;
		provider.setFilter({ ...provider.getFilter(), messageRegex: '^feat:' });
		expect(memento.get('hyperGit.log.filter:/repo-a')).toBeDefined();

		// 空白输入经 re && re.trim() 规约为 undefined（清除维度），组合 key 归一化后全空即删。
		await withPendingDialog(vi.mocked(vscode.window.showInputBox), '  ', regex);
		expect(provider.getFilter()).toEqual({});
		expect(memento.get('hyperGit.log.filter:/repo-a')).toBeUndefined();
		provider.dispose();
	});

	it('regex 切库守卫：输入框期间切库，确认不把旧仓库输入写入新仓库持久化 key', async () => {
		const memento = new MemMemento();
		const { provider, service } = makeWiring('/repo-a', memento);
		const regex = h.handlers.get('hyperGit.logFilterRegex') as () => Promise<void>;

		await withPendingDialog(vi.mocked(vscode.window.showInputBox), '^feat:', regex, () => service.fireRepoChange('/repo-b'));
		expect(provider.getFilter()).toEqual({});
		expect(memento.get('hyperGit.log.filter:/repo-a')).toBeUndefined();
		expect(memento.get('hyperGit.log.filter:/repo-b')).toBeUndefined();
		provider.dispose();
	});

	it('logFilter 聚合入口切库守卫：选择器期间切库，Clear Filter 不删新仓库的持久化 key', async () => {
		const memento = new MemMemento();
		memento.update('hyperGit.log.authors:/repo-b', JSON.stringify([BOB]));
		const { provider, service } = makeWiring('/repo-a', memento);
		const filter = h.handlers.get('hyperGit.logFilter') as () => Promise<void>;

		await withPendingDialog(
			vi.mocked(vscode.window.showQuickPick),
			{ label: 'Clear Filter', description: 'remove all active filters', action: 'hyperGit.logClearFilter' },
			filter,
			() => service.fireRepoChange('/repo-b'),
		);
		// 守卫生效：B 的持久化 authors 未被清（无守卫时 clearFilter 会删 hyperGit.log.authors:/repo-b）。
		expect(memento.get('hyperGit.log.authors:/repo-b')).toBe(JSON.stringify([BOB]));
		expect(provider.getFilter()).toEqual({ authors: [BOB] });
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
