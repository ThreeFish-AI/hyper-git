import * as vscode from 'vscode';
import { CommitPipeline } from '../../engine/commit/pipeline';
import { CheckinResult } from '../../engine/commit/pipeline';
import type { CheckinHook } from '../../engine/commit/pipeline';
import { validateConventional } from '../../engine/commit/conventional-linter';
import type { ConventionalValidation } from '../../engine/commit/conventional-linter';
import type { Repository } from '../../types/git';
import type { ChangeItem, GitRepositoryService } from '../git-repository-service';
import type {
	IChangelistGrouper,
	ICommitMessageProvider,
	IConflictResolver,
	ILlmProvider,
	IPreCommitInspector,
} from '../../agent';
import { ConventionalCommitCheck } from './conventional-check';

export interface CommitRequest {
	readonly message: string;
	readonly selectedPaths: readonly string[];
	readonly amend: boolean;
	readonly signoff: boolean;
	readonly skipHooks: boolean;
	readonly push: boolean;
}

export interface CommitOutcome {
	readonly ok: boolean;
	readonly error?: string;
	/** 提交成功但后续操作（如 push）失败时的提示。 */
	readonly warning?: string;
}

/** Commit 流水线依赖的 AI 接缝集合（Null 实现注入，M5 替换为真实实现）。 */
export interface AiSeams {
	readonly llm: ILlmProvider;
	readonly commitMessage: ICommitMessageProvider;
	readonly preCommit: IPreCommitInspector;
	readonly grouper: IChangelistGrouper;
	readonly conflict: IConflictResolver;
}

const RECENT_KEY = 'hyperGit.recentCommitMessages';
const RECENT_MAX = 10;

/**
 * CommitService：编排提交流水线（参考 JetBrains checkin 流程设计）。
 *
 * 流程：校验信息 → 解析选中文件 → stage → CommitPipeline 责任链（Checkin hook）→ commit → 可选 push。
 * 注入 5 个 AI 接缝（Null 实现），为 M5 即插即用预留。
 */
export class CommitService implements vscode.Disposable {
	private readonly pipeline: CommitPipeline;
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange: vscode.Event<void> = this._onDidChange.event;

	constructor(
		context: vscode.ExtensionContext,
		private readonly service: GitRepositoryService,
		private readonly workspaceState: vscode.Memento,
		readonly ai: AiSeams,
	) {
		const hooks: readonly CheckinHook[] = [
			new ConventionalCommitCheck(() => this.conventionalEnabled()),
			ai.preCommit,
		];
		this.pipeline = new CommitPipeline(hooks);
		context.subscriptions.push(this._onDidChange);
	}

	get repo(): Repository | null {
		return this.service.repo;
	}

	validateMessage(message: string): ConventionalValidation {
		return validateConventional(message);
	}

	conventionalEnabled(): boolean {
		return vscode.workspace.getConfiguration('hyperGit.commit').get('conventional', true);
	}

	getTemplate(): string {
		return vscode.workspace.getConfiguration('hyperGit.commit').get('template', '') ?? '';
	}

	getRecentMessages(): readonly string[] {
		const raw = this.workspaceState.get<string>(RECENT_KEY);
		try {
			return raw ? (JSON.parse(raw) as string[]) : [];
		} catch {
			return [];
		}
	}

	private pushRecent(message: string): void {
		const trimmed = message.trim();
		const list = [trimmed, ...this.getRecentMessages().filter((m) => m !== trimmed)].slice(0, RECENT_MAX);
		void this.workspaceState.update(RECENT_KEY, JSON.stringify(list));
	}

	/** 提交：stage 选中文件 → Checkin hook 链 → commit → 可选 push。 */
	async executeCommit(req: CommitRequest): Promise<CommitOutcome> {
		const repo = this.service.repo;
		if (!repo) {
			return { ok: false, error: 'No Git repository found' };
		}
		const message = req.message.trim();
		if (!message) {
			return { ok: false, error: 'Commit message cannot be empty' };
		}

		// CC 即时校验（pipeline 内的 hook 亦会拦截，此处给出明确原因）
		if (this.conventionalEnabled()) {
			const v = validateConventional(message);
			if (v.severity === 'error') {
				return { ok: false, error: v.reason ?? 'Commit message does not conform to Conventional Commits' };
			}
		}

		// 解析选中文件的绝对路径
		const changes = this.service.getChanges();
		const checkedSet = new Set(req.selectedPaths);
		const absPaths = this.resolveAbsolute(req.selectedPaths, changes);
		if (absPaths.length === 0) {
			return { ok: false, error: 'No files selected to commit' };
		}

		// Checkin hook 责任链（传绝对路径，供未来 AI hook 读取文件内容）
		const hookResult = await this.pipeline.run({ message, filePaths: absPaths });
		if (hookResult === CheckinResult.Cancel) {
			return { ok: false, error: 'Commit blocked by check (Checkin hook)' };
		}

		try {
			// 让勾选集成为提交的权威范围：未勾选的已暂存文件先 unstage（参考 JetBrains「提交该集合」语义）
			const toUnstage = changes.filter((c) => c.staged && !checkedSet.has(c.relativePath)).map((c) => c.uri.fsPath);
			if (toUnstage.length > 0) {
				await repo.restore(toUnstage, { staged: true });
			}
			await repo.add(absPaths);
			await repo.commit(message, { amend: req.amend, signoff: req.signoff, noVerify: req.skipHooks });
			this.pushRecent(message);
			this._onDidChange.fire();
			if (req.push) {
				try {
					await repo.push();
				} catch (e) {
					return { ok: true, warning: `Commit succeeded, but push failed: ${this.normalizeError(e)}` };
				}
			}
			return { ok: true };
		} catch (e) {
			return { ok: false, error: this.normalizeError(e) };
		}
	}

	private resolveAbsolute(selectedPaths: readonly string[], changes: readonly ChangeItem[]): string[] {
		const map = new Map(changes.map((c) => [c.relativePath, c.uri.fsPath]));
		const out: string[] = [];
		for (const p of selectedPaths) {
			const abs = map.get(p);
			if (abs) {
				out.push(abs);
			}
		}
		return out;
	}

	private normalizeError(e: unknown): string {
		if (e instanceof Error) {
			return e.message;
		}
		return String(e);
	}

	dispose(): void {
		this._onDidChange.dispose();
	}
}
