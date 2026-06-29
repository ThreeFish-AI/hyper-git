/**
 * Webview（Commit 窗口）↔ Extension Host 的消息类型契约。
 *
 * 【单一事实源】前端（webview 内联 JS）与宿主（adapter/webview/）共同遵循本契约，
 * 杜绝两侧各定义一份造成 Split-Brain。随里程碑演进在此扩展。
 */

import type { ConventionalValidation, ConventionalSeverity } from '../engine/commit/conventional-linter';
import type { GraphLayoutRow } from '../engine/log/graph-types';
import type { LogScope } from '../engine/log/log-query';

export type { ConventionalValidation, ConventionalSeverity };

/** Commit 视图中的文件条目（选中态由 webview 端管理，host 不回写以避免覆盖用户操作）。 */
export interface CommitFileItem {
	readonly path: string; // 仓库相对路径（key）
	readonly label: string; // basename
	readonly dir: string; // dirname
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

// ─────────────────────────────────────────────────────────────────────────────
// Log Graph 视图（hyperGit.log，Webview）↔ Extension Host 消息契约。
// 与 Commit 视图的 union 相互独立（两个 disjoint webview，各自一套消息）。
// 行布局数据（layout: GraphLayoutRow）来自 engine/log/graph-layout 纯逻辑引擎。
// ─────────────────────────────────────────────────────────────────────────────

export type { LogScope };

/** 提交行的引用标签（HEAD / 本地分支 / 远程分支 / 标签）。 */
export interface RefChip {
	readonly name: string;
	readonly kind: 'head' | 'localBranch' | 'remoteBranch' | 'tag';
	/** HEAD 当前指向的本地分支（加粗 / 箭头强调）。 */
	readonly isHeadTarget?: boolean;
}

/** 单条提交行的视图模型：原始数据 + 计算好的图布局 + 引用标签。 */
export interface GraphRowVM {
	readonly hash: string;
	readonly shortHash: string;
	readonly parents: readonly string[];
	readonly isMerge: boolean;
	readonly subject: string;
	readonly authorName: string;
	readonly authorDate: string;
	readonly chips: readonly RefChip[];
	readonly layout: GraphLayoutRow;
}

/** 选中提交的变更文件项（themeColor 为 gitDecoration.* 主题色 id）。 */
export interface LogCommitFileItem {
	readonly status: string;
	readonly statusLabel: string;
	readonly path: string;
	readonly oldPath?: string;
	readonly themeColor: string;
}

/** Host → Webview：图数据全量重置（首帧 / 刷新 / 过滤 / 范围切换）。 */
export interface LogGraphState {
	readonly rows: readonly GraphRowVM[];
	readonly maxLanes: number;
	readonly hasMore: boolean;
	readonly scope: LogScope;
	readonly repoRoot: string;
}

/** per-commit 操作枚举（webview 右键菜单 → host 重调用既有命令）。 */
export type LogCommitOp =
	| 'copy'
	| 'cherryPick'
	| 'revert'
	| 'drop'
	| 'fixup'
	| 'newBranch'
	| 'newTag'
	| 'containingBranches'
	| 'reset'
	| 'menu';

/** Host → Webview（Log Graph）。 */
export type LogHostToWebviewMessage =
	| { readonly type: 'log/graphData'; readonly payload: LogGraphState }
	| {
		readonly type: 'log/appendData';
		readonly payload: { readonly rows: readonly GraphRowVM[]; readonly maxLanes: number; readonly hasMore: boolean };
	}
	| { readonly type: 'log/commitFiles'; readonly payload: { readonly hash: string; readonly files: readonly LogCommitFileItem[] } }
	| { readonly type: 'log/busy'; readonly payload: { readonly busy: boolean } };

/** Webview → Host（Log Graph）。 */
export type LogWebviewToHostMessage =
	| { readonly type: 'log/requestState' }
	| { readonly type: 'log/loadMore'; readonly payload: { readonly cursor: number } }
	| { readonly type: 'log/selectCommit'; readonly payload: { readonly hash: string } }
	| { readonly type: 'log/commitAction'; readonly payload: { readonly op: LogCommitOp; readonly hash: string } }
	| { readonly type: 'log/setScope'; readonly payload: { readonly scope: LogScope } }
	| { readonly type: 'log/openFile'; readonly payload: { readonly hash: string; readonly path: string; readonly hasParent: boolean } };
