import * as vscode from 'vscode';

/**
 * Stash 视图 TreeDataProvider。
 *
 * ⚠️ vscode.git 稳定 API 不暴露 `git stash list`。曾尝试 `log({ refNames: ['stash'] })`，
 * 但经实测其仅返回**最新一个 stash 的内部提交**（WIP commit / parent / index commit），
 * 非 stash 栈列表（语义错误）——故弃用。
 *
 * 现视图保持空（由 viewsWelcome 引导），stash 操作（create/apply/pop/drop）作用于 stash@{0}（最新）。
 * 多 stash 列表枚举为 API 限制，未来经 git CLI 兜底或 proposed API 评估（见 implementation-status §3）。
 */
export class StashTreeProvider implements vscode.TreeDataProvider<never>, vscode.Disposable {
	private readonly _onDidChange = new vscode.EventEmitter<never | undefined>();
	readonly onDidChangeTreeData = this._onDidChange.event;

	refresh(): void {
		this._onDidChange.fire(undefined);
	}

	getTreeItem(): vscode.TreeItem {
		return new vscode.TreeItem('');
	}

	getChildren(): never[] {
		return [];
	}

	dispose(): void {
		this._onDidChange.dispose();
	}
}
