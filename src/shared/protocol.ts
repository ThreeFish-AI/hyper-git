/**
 * Webview（Commit 窗口）↔ Extension Host 的消息类型契约。
 *
 * 【单一事实源】前端（webview 内联 JS）与宿主（adapter/webview/）共同遵循本契约，
 * 杜绝两侧各定义一份造成 Split-Brain。随里程碑演进在此扩展。
 */

import type { ConventionalValidation, ConventionalSeverity } from '../engine/commit/conventional-linter';
import type { CiCheckVM, CiState, CiStatusVM } from '../engine/ci/types';
import type { GraphLayoutRow } from '../engine/log/graph-types';
import type { LogScope } from '../engine/log/log-query';

export type { ConventionalValidation, ConventionalSeverity };
// CI 状态 VM 从 engine 复用并 re-export（指针非副本，单一事实源）。
export type { CiCheckVM, CiState, CiStatusVM };

/** Commit 视图中的文件条目（选中态由 webview 端管理，host 不回写以避免覆盖用户操作）。 */
export interface CommitFileItem {
	readonly path: string; // 仓库相对路径（key）
	readonly label: string; // basename
	readonly dir: string; // dirname
	readonly themeColor: string; // gitDecoration.* 主题色 id → webview 用 var(--vscode-...)
}

/**
 * 视图无关的目录树节点（「Group By Directory」形态）。
 *
 * 【复用 graph-layout 先例】树结构由 host 侧 {@link ../engine/tree/file-tree}.buildFileTree 纯逻辑
 * 计算后随 payload 下发，webview 仅按 mode 渲染平铺或树形，切换不触发 host 往返。叶子以 `fileIndex`
 * 回指同批扁平 `files[]`（COMMIT 为 {@link CommitFileItem}，LOG 为 {@link LogCommitFileItem}），
 * 故同一套渲染器可服务两个视图，且不复制条目数据（单一事实源）。
 */
export interface FileTreeNode {
	readonly name: string; // 展示段：目录名 / compact 折叠的 "a/b" / 文件 basename
	readonly dir: boolean; // true=目录，false=叶子文件
	readonly path: string; // 目录=完整目录路径（展开/折叠稳定 key）；叶子=对应扁平条目的 path
	readonly fileIndex?: number; // 仅叶子：回指扁平 files[] 的下标
	readonly children?: readonly FileTreeNode[]; // 仅目录
}

/** Commit 头部切换下拉的 changelist 条目（含文件计数，空列表也在内以便切换）。 */
export interface CommitChangelistItem {
	readonly id: string;
	readonly name: string;
	readonly count: number;
}

export interface CommitViewState {
	readonly template: string;
	readonly recentMessages: readonly string[];
	readonly activeChangelistName: string;
	readonly activeChangelistId: string;
	/** 全部 changelist（含空列表，供头部切换下拉 / 展示计数）。 */
	readonly changelists: readonly CommitChangelistItem[];
	/** 活动 changelist 的文件（提交目标；平铺形态直接渲染）。 */
	readonly files: readonly CommitFileItem[];
	/** 活动 changelist 文件的目录树（host 侧构建，供 Group By Directory 形态渲染）。 */
	readonly tree: readonly FileTreeNode[];
	readonly conventionalEnabled: boolean;
	readonly busy: boolean;
}

/** Host → Webview */
export type HostToWebviewMessage =
	| { readonly type: 'state'; readonly payload: CommitViewState }
	| { readonly type: 'conventionalValidation'; readonly payload: ConventionalValidation }
	| { readonly type: 'commitResult'; readonly payload: { readonly ok: boolean; readonly error?: string; readonly warning?: string } };

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
	}
	// ── 由旧 Changes 树平移而来的文件 / changelist 操作（webview 右键/点击 → host 复用既有命令）── //
	| { readonly type: 'commit/openFile'; readonly payload: { readonly path: string } }
	| { readonly type: 'commit/fileMenu'; readonly payload: { readonly path: string } }
	| { readonly type: 'commit/setActive'; readonly payload: { readonly id: string } }
	| { readonly type: 'commit/changelistMenu'; readonly payload: { readonly id: string } };

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
	/** 作者邮箱（%ae）：供悬浮详情显示 name <email>。 */
	readonly authorEmail: string;
	readonly authorDate: string;
	/** 提交者名（%cn）：仅当与作者不同才在悬浮详情单列。 */
	readonly committerName: string;
	/** 提交者日期（%cI，ISO 严格）。 */
	readonly committerDate: string;
	/** 完整提交消息正文（%b，不含 subject；host 侧已截断至上限以控 payload）。 */
	readonly body: string;
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

/** 提交的变更统计（对齐 `git ... --shortstat`）。 */
export interface CommitDetailStat {
	readonly files: number;
	readonly insertions: number;
	readonly deletions: number;
}

/**
 * Commit 详情面板视图模型（编辑器区 WebviewPanel 显示，对齐官方 Source Control Graph）。
 * host 侧一次备齐：基础字段（git show）+ 相对/绝对时间（预格式化）+ 变更统计 + 可选 GitHub 提交页 URL。
 */
export interface CommitDetailVM {
	readonly hash: string;
	readonly shortHash: string;
	readonly subject: string;
	readonly body: string;
	readonly authorName: string;
	readonly authorEmail: string;
	/** 作者时间 ISO（%aI）。 */
	readonly authorDate: string;
	/** 相对时间（host 预格式化，如 "2 days ago"）。 */
	readonly authorDateRel: string;
	/** 绝对时间（host 预格式化，本地化）。 */
	readonly authorDateAbs: string;
	readonly committerName: string;
	readonly committerDate: string;
	readonly parents: readonly string[];
	readonly stat: CommitDetailStat;
	/** GitHub 提交页 URL；远程非 GitHub 时缺省，面板隐藏「Open on GitHub」。 */
	readonly githubUrl?: string;
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

/** CI 功能元信息（graphData 后即发；登录完成/会话撤销/限流时再发，避免整图重传重置滚动/选中）。 */
export interface CiMetaVM {
	/** 远程为 GitHub 且功能启用时为 true；否则整列隐藏、不发起任何请求。 */
	readonly available: boolean;
	/** 远程是 GitHub 但尚未授权：webview 显示「登录 GitHub 查看 CI」提示。 */
	readonly needsSignIn: boolean;
	/** 软错误（限流/网络）摘要，供 webview 给出一次性提示；为空表示正常。 */
	readonly error?: string;
}

/** Host → Webview（Log Graph）。 */
export type LogHostToWebviewMessage =
	| { readonly type: 'log/graphData'; readonly payload: LogGraphState }
	| {
		readonly type: 'log/appendData';
		readonly payload: { readonly rows: readonly GraphRowVM[]; readonly maxLanes: number; readonly hasMore: boolean };
	}
	| {
		readonly type: 'log/commitFiles';
		readonly payload: {
			readonly hash: string;
			readonly files: readonly LogCommitFileItem[];
			/** 变更文件的目录树（host 侧构建，供 Group By Directory 形态渲染）。 */
			readonly tree: readonly FileTreeNode[];
		};
	}
	| { readonly type: 'log/busy'; readonly payload: { readonly busy: boolean } }
	| { readonly type: 'log/error'; readonly payload: { readonly message: string } }
	| { readonly type: 'log/ciMeta'; readonly payload: CiMetaVM }
	| { readonly type: 'log/ciData'; readonly payload: { readonly map: Readonly<Record<string, CiStatusVM>> } }
	| { readonly type: 'log/commitDetail'; readonly payload: { readonly vm: CommitDetailVM | null } };

/** Webview → Host（Log Graph）。 */
export type LogWebviewToHostMessage =
	| { readonly type: 'log/requestState' }
	| { readonly type: 'log/retry' }
	| { readonly type: 'log/loadMore'; readonly payload: { readonly cursor: number } }
	| { readonly type: 'log/selectCommit'; readonly payload: { readonly hash: string } }
	| { readonly type: 'log/commitAction'; readonly payload: { readonly op: LogCommitOp; readonly hash: string } }
	| { readonly type: 'log/setScope'; readonly payload: { readonly scope: LogScope } }
	| { readonly type: 'log/openFile'; readonly payload: { readonly hash: string; readonly path: string; readonly hasParent: boolean } }
	| { readonly type: 'log/requestCi'; readonly payload: { readonly hashes: readonly string[] } }
	| { readonly type: 'log/ciSignIn' }
	| { readonly type: 'log/openExternal'; readonly payload: { readonly url: string } }
	/** 悬停提交行 → 请求在右侧编辑器区打开该提交的详情面板。 */
	| { readonly type: 'log/showCommitDetail'; readonly payload: { readonly hash: string } };

/** Host → Commit 详情面板（编辑器区 WebviewPanel）。 */
export type CommitDetailHostToWebviewMessage =
	/** 详情数据到达（null = 取数失败/坏 hash，面板显示空态）。 */
	| { readonly type: 'commitDetail/data'; readonly payload: CommitDetailVM | null };

/** Commit 详情面板 → Host。 */
export type CommitDetailWebviewToHostMessage =
	| { readonly type: 'commitDetail/openExternal'; readonly payload: { readonly url: string } };
