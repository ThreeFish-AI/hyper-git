/**
 * Webview（Commit 窗口 / Log 图）↔ Extension Host 的消息类型契约。
 *
 * 【单一事实源】前端（ui/）与宿主（adapter/webview/）共同 import 本文件，
 * 杜绝两侧各定义一份 message interface 造成 Split-Brain。
 * 随里程碑演进，新增消息类型在此扩展。
 */

export interface CommitViewState {
	readonly template: string;
	readonly recentMessages: readonly string[];
	readonly fileCount: number;
	readonly amendEnabled: boolean;
}

export interface ConventionalValidation {
	readonly valid: boolean;
	readonly reason?: string;
}

/** Host → Webview */
export type HostToWebviewMessage =
	| { readonly type: 'state'; readonly payload: CommitViewState }
	| { readonly type: 'conventionalValidation'; readonly payload: ConventionalValidation };

/** Webview → Host */
export type WebviewToHostMessage =
	| { readonly type: 'requestState' }
	| { readonly type: 'messageChanged'; readonly payload: { readonly message: string } }
	| { readonly type: 'commit'; readonly payload: { readonly message: string; readonly amend: boolean; readonly push: boolean } };
