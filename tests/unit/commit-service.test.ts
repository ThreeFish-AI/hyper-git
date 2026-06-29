import { describe, it, expect, vi } from 'vitest';

// 桩 vscode：CommitService 依赖 workspace.getConfiguration 与 EventEmitter。
vi.mock('vscode', () => ({
	workspace: {
		getConfiguration: () => ({ get: (_key: string, def: unknown) => def }),
	},
	EventEmitter: class {
		get event() {
			return () => ({ dispose: () => undefined });
		}
		fire() {}
		dispose() {}
	},
}));

import { FileStatus } from '../../src/engine/model';
import type { Repository } from '../../src/types/git';
import type { ChangeItem, GitRepositoryService } from '../../src/adapter/git-repository-service';
import { CommitService } from '../../src/adapter/commit/commit-service';
import type { CommitRequest } from '../../src/adapter/commit/commit-service';
import { NullChangelistGrouper } from '../../src/agent/grouper';
import { NullCommitMessageProvider } from '../../src/agent/commit-message';
import { NullConflictResolver } from '../../src/agent/conflict';
import { NullLlmProvider } from '../../src/agent/llm-provider';
import { NullPreCommitInspector } from '../../src/agent/pre-commit';

type RepoLike = Pick<Repository, 'add' | 'commit' | 'restore' | 'push'>;

function makeRepo(overrides: Partial<RepoLike> = {}): Repository {
	return {
		add: vi.fn(async () => undefined),
		commit: vi.fn(async () => undefined),
		restore: vi.fn(async () => undefined),
		push: vi.fn(async () => undefined),
		...overrides,
	} as unknown as Repository;
}

const change = (relPath: string, staged = false): ChangeItem => ({
	relativePath: relPath,
	uri: { fsPath: `/repo/${relPath}` } as unknown as ChangeItem['uri'],
	originalUri: { fsPath: `/repo/${relPath}` } as unknown as ChangeItem['originalUri'],
	status: FileStatus.Modified,
	staged,
});

function makeCommitService(repo: Repository, changes: ChangeItem[]): CommitService {
	const ctx = { subscriptions: [] as unknown[] } as unknown as Parameters<typeof CommitService>[0];
	const state = { get: () => undefined, update: vi.fn(async () => undefined) } as unknown as Parameters<typeof CommitService>[2];
	const service = { repo, getChanges: () => changes } as unknown as GitRepositoryService;
	return new CommitService(ctx, service, state, {
		llm: new NullLlmProvider(),
		commitMessage: new NullCommitMessageProvider(),
		preCommit: new NullPreCommitInspector(),
		grouper: new NullChangelistGrouper(),
		conflict: new NullConflictResolver(),
	});
}

const REQ = (overrides: Partial<CommitRequest>): CommitRequest => ({
	message: 'feat: x',
	selectedPaths: ['a.ts'],
	amend: false,
	signoff: false,
	skipHooks: false,
	push: false,
	...overrides,
});

describe('CommitService.executeCommit', () => {
	it('空信息 → error', async () => {
		const cs = makeCommitService(makeRepo(), [change('a.ts')]);
		const r = await cs.executeCommit(REQ({ message: '   ' }));
		expect(r.ok).toBe(false);
		expect(r.error).toContain('不能为空');
	});

	it('CC 不合规（默认 conventional=true）→ error', async () => {
		const cs = makeCommitService(makeRepo(), [change('a.ts')]);
		const r = await cs.executeCommit(REQ({ message: 'bad message' }));
		expect(r.ok).toBe(false);
		expect(r.error).toBeTruthy();
	});

	it('未选文件 → error', async () => {
		const cs = makeCommitService(makeRepo(), [change('a.ts')]);
		const r = await cs.executeCommit(REQ({ selectedPaths: [] }));
		expect(r.ok).toBe(false);
		expect(r.error).toContain('未选择');
	});

	it('合规 + 勾选 → commit 透传 amend/signoff/noVerify，返回 ok', async () => {
		const repo = makeRepo();
		const cs = makeCommitService(repo, [change('a.ts')]);
		const r = await cs.executeCommit(REQ({ message: 'feat: amend test', amend: true, signoff: true, skipHooks: true }));
		expect(r.ok).toBe(true);
		expect(repo.commit).toHaveBeenCalledWith('feat: amend test', { amend: true, signoff: true, noVerify: true });
		expect(repo.add).toHaveBeenCalledWith(['/repo/a.ts']);
	});

	it('未勾选的已暂存文件被 unstage（restore --staged）', async () => {
		const repo = makeRepo();
		const cs = makeCommitService(repo, [change('a.ts', true), change('b.ts', true)]);
		await cs.executeCommit(REQ({ selectedPaths: ['a.ts'] }));
		expect(repo.restore).toHaveBeenCalledWith(['/repo/b.ts'], { staged: true });
	});

	it('push 成功 → ok', async () => {
		const repo = makeRepo();
		const cs = makeCommitService(repo, [change('a.ts')]);
		const r = await cs.executeCommit(REQ({ push: true }));
		expect(r.ok).toBe(true);
		expect(repo.push).toHaveBeenCalled();
	});

	it('push 失败 → ok:true + warning（commit 已成功）', async () => {
		const repo = makeRepo({ push: vi.fn(async () => { throw new Error('network'); }) });
		const cs = makeCommitService(repo, [change('a.ts')]);
		const r = await cs.executeCommit(REQ({ push: true }));
		expect(r.ok).toBe(true);
		expect(r.warning).toContain('推送失败');
		expect(repo.commit).toHaveBeenCalled();
	});
});
