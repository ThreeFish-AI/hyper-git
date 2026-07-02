import { CheckinResult } from '../../engine/commit/pipeline';
import type { CheckinHook, CommitInfo } from '../../engine/commit/pipeline';
import { validateConventional } from '../../engine/commit/conventional-linter';

/**
 * 内置非 AI 提交检查：Conventional Commits 校验（参考 JetBrains CheckinHandler 闸门语义）。
 *
 * 当配置 `hyperGit.commit.conventional` 开启时，校验失败（severity=error）阻断提交，
 * 用以证明 CommitPipeline 责任链可注入并阻断（M5 的 AI 审查 hook 将以同样方式接入）。
 */
export class ConventionalCommitCheck implements CheckinHook {
	readonly name = 'conventional-commit-check';
	readonly executionOrder = 10;

	constructor(private readonly isEnabled: () => boolean) {}

	async beforeCheckin(info: CommitInfo): Promise<CheckinResult> {
		if (!this.isEnabled()) {
			return CheckinResult.Commit;
		}
		const result = validateConventional(info.message);
		return result.severity === 'error' ? CheckinResult.Cancel : CheckinResult.Commit;
	}
}
