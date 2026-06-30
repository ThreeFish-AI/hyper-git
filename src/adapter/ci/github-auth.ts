/**
 * GitHub 认证（adapter 层，唯一触碰 vscode.authentication）。
 *
 * 复用 VS Code 内置 GitHub 认证 provider，凭证由编辑器托管，绝不经过 chat/日志。
 * - `repo` 范围：覆盖私有仓库的 Checks（Actions）+ Commit Status 读取（`repo:status` 不覆盖 Checks）。
 * - 静默 `peek`（createIfNone:false）：仅复用已存在会话，绝不弹窗；`signIn`（createIfNone:true）仅在
 *   用户显式点击「登录」时由命令触发。provider id 随主机定（github.com→`github`，GHE→`github-enterprise`）。
 */

import * as vscode from 'vscode';

export type GitHubAuthProviderId = 'github' | 'github-enterprise';

/** 读 CI（私有仓库的 Checks + Statuses）所需范围。 */
const GITHUB_SCOPES = ['repo'] as const;

export class GitHubAuth {
	/** 已缓存的会话（undefined 表示「已探测且无会话」；has() 区分「未探测」与「无会话」避免重复 getSession）。 */
	private readonly cached = new Map<GitHubAuthProviderId, vscode.AuthenticationSession | undefined>();

	constructor(disposables: vscode.Disposable[]) {
		disposables.push(
			vscode.authentication.onDidChangeSessions((e) => {
				const id = e.provider.id;
				if (id === 'github' || id === 'github-enterprise') {
					this.cached.delete(id as GitHubAuthProviderId);
				}
			}),
		);
	}

	/** 静默探测：仅返回已存在会话，永不弹窗。provider 未注册（GHE 未配置）时抛错，由调用方捕获。 */
	async peek(provider: GitHubAuthProviderId): Promise<vscode.AuthenticationSession | undefined> {
		if (this.cached.has(provider)) {
			return this.cached.get(provider);
		}
		const session = await vscode.authentication.getSession(provider, [...GITHUB_SCOPES], { createIfNone: false });
		this.cached.set(provider, session);
		return session;
	}

	/** 交互式登录：显示原生授权 UI。仅在用户显式手势触发时调用。 */
	async signIn(provider: GitHubAuthProviderId): Promise<vscode.AuthenticationSession | undefined> {
		try {
			const session = await vscode.authentication.getSession(provider, [...GITHUB_SCOPES], { createIfNone: true });
			this.cached.set(provider, session);
			return session;
		} catch {
			// 用户取消授权：保持未登录，不抛错。
			return undefined;
		}
	}

	/** 失效缓存（401 时调用，强制下次重新解析会话）。 */
	invalidate(provider: GitHubAuthProviderId): void {
		this.cached.delete(provider);
	}
}
