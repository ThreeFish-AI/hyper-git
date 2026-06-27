/**
 * Webview（Commit 窗口）↔ Extension Host 的消息类型契约。
 *
 * 【单一事实源】前端（webview 内联 JS）与宿主（adapter/webview/）共同遵循本契约，
 * 杜绝两侧各定义一份造成 Split-Brain。随里程碑演进在此扩展。
 */

import type { ConventionalValidation, ConventionalSeverity } from '../engine/commit/conventional-linter';

export type { ConventionalValidation, ConventionalSeverity };

/** Commit 视图中的文件条目（选中态由 webview 端管理，host 不回写以避免覆盖用户操作）。 */
export interface CommitFileItem {
	readonly path: string; // 仓库相对路径（key）
	readonly label: string; // basename
	readonly dir: string; // dirname
	readonly status: string; // FileStatus 字母（M/A/D/...）
	readonly statusName: string; // 状态名（Modified/...）
	readonly themeColor: string; // gitDecoration.* 主题色 id → webview 用 var(--vscode-...)
}

export interface CommitViewState {
	readonly template: string;
	readonly recentMessages: readonly string[];
	readonly activeChangelistName: string;
	readonly files: readonly CommitFileItem[];
	readonly conventionalEnabled: boolean;
	readonly busy: boolean;
}

/** Host → Webview */
export type HostToWebviewMessage =
	| { readonly type: 'state'; readonly payload: CommitViewState }
	| { readonly type: 'conventionalValidation'; readonly payload: ConventionalValidation }
	| { readonly type: 'commitResult'; readonly payload: { readonly ok: boolean; readonly error?: string } };

/** Webview → Host */
export type WebviewToHostMessage =
	| { readonly type: 'requestState' }
	| { readonly type: 'messageChanged'; readonly payload: { readonly message: string } }
	| {
		readonly type: 'commit';
		readonly payload: {
			readonly message: string;
			readonly selectedPaths: readonly string[];
			readonly amend: boolean;
			readonly signoff: boolean;
			readonly skipHooks: boolean;
			readonly push: boolean;
		};
	};
