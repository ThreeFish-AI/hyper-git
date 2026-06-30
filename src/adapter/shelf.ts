import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { GitRepositoryService } from './git-repository-service';
import { handleGitConflict } from './conflict-ui';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function sanitize(name: string): string {
	return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'unnamed';
}

interface ShelfEntry {
	readonly name: string;
	readonly paths: readonly string[];
	readonly timestamp: string;
	readonly patch: string;
}

/** ShelfTreeProvider 节点。 */
export interface ShelfNode {
	readonly kind: 'shelf';
	readonly name: string;
	readonly paths: readonly string[];
	readonly timestamp: string;
}

/**
 * ShelfService：基于 patch 的 Shelf 实现（独立于 git stash）。
 *
 * - Shelve：`git diff -- <paths>` → 存 patch 到扩展存储 → `git checkout --` 移除工作区改动（变更保留在 patch）。
 * - Unshelve：读取 patch → `git apply`（静默）或 `git apply --3way`（三方合并冲突解决）。
 * - Drop：删除 patch 文件。
 *
 * 与 git stash 的区别：Shelf 是命名 patch 序列（扩展存储），不占用 git stash 栈；可同时保留多个独立 shelf。
 */
export class ShelfService {
	private readonly shelvesDir: string;

	constructor(private readonly service: GitRepositoryService, storageDir: string) {
		this.shelvesDir = path.join(storageDir, 'shelves');
	}

	async shelve(name: string, paths: readonly string[], timestamp: string): Promise<void> {
		const repo = this.service.repo;
		if (!repo) {
			throw new Error('未找到 Git 仓库');
		}
		const patch = await this.service.execGit(['diff', '--', ...paths]);
		if (!patch.trim()) {
			throw new Error('所选文件无改动（或为未跟踪文件）');
		}
		fs.mkdirSync(this.shelvesDir, { recursive: true });
		const entry: ShelfEntry = { name, paths, timestamp, patch };
		fs.writeFileSync(path.join(this.shelvesDir, `${sanitize(name)}.json`), JSON.stringify(entry, null, 2));
		// 移除工作区改动（变更已保存在 patch）
		await this.service.execGit(['checkout', '--', ...paths]);
	}

	async unshelve(name: string, threeWay: boolean): Promise<void> {
		const entry = this.readEntry(name);
		if (!entry) {
			throw new Error(`Shelf「${name}」不存在`);
		}
		const tmp = path.join(os.tmpdir(), `hg-unshelve-${Date.now()}.patch`);
		fs.writeFileSync(tmp, entry.patch);
		try {
			const args = ['apply'];
			if (threeWay) {
				args.push('--3way');
			}
			args.push(tmp);
			await this.service.execGit(args);
		} finally {
			try {
				fs.unlinkSync(tmp);
			} catch {
				/* ignore */
			}
		}
	}

	async unshelveAndDrop(name: string, threeWay: boolean): Promise<void> {
		await this.unshelve(name, threeWay);
		this.drop(name);
	}

	drop(name: string): void {
		const file = path.join(this.shelvesDir, `${sanitize(name)}.json`);
		if (fs.existsSync(file)) {
			fs.unlinkSync(file);
		}
	}

	listShelves(): ShelfNode[] {
		if (!fs.existsSync(this.shelvesDir)) {
			return [];
		}
		return fs
			.readdirSync(this.shelvesDir)
			.filter((f) => f.endsWith('.json'))
			.map((f) => {
				try {
					const entry = JSON.parse(fs.readFileSync(path.join(this.shelvesDir, f), 'utf8')) as ShelfEntry;
					return { kind: 'shelf' as const, name: entry.name, paths: entry.paths, timestamp: entry.timestamp };
				} catch {
					return null;
				}
			})
			.filter((n): n is ShelfNode => n !== null);
	}

	private readEntry(name: string): ShelfEntry | null {
		const file = path.join(this.shelvesDir, `${sanitize(name)}.json`);
		if (!fs.existsSync(file)) {
			return null;
		}
		try {
			return JSON.parse(fs.readFileSync(file, 'utf8')) as ShelfEntry;
		} catch {
			return null;
		}
	}
}

/** Shelf TreeView：显示已存储的 shelf 条目。 */
export class ShelfTreeProvider implements vscode.TreeDataProvider<ShelfNode>, vscode.Disposable {
	private readonly _onDidChange = new vscode.EventEmitter<ShelfNode | undefined>();
	readonly onDidChangeTreeData = this._onDidChange.event;

	constructor(private readonly shelfService: ShelfService) {}

	refresh(): void {
		this._onDidChange.fire(undefined);
	}

	getChildren(): ShelfNode[] {
		return this.shelfService.listShelves();
	}

	getTreeItem(node: ShelfNode): vscode.TreeItem {
		const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
		item.id = `shelf:${node.name}`;
		item.description = `${node.paths.length} files · ${node.timestamp}`;
		item.tooltip = `${node.name}\n${node.paths.length} files\nShelved: ${node.timestamp}`;
		item.contextValue = 'hyperGit.shelf';
		item.iconPath = new vscode.ThemeIcon('inbox');
		return item;
	}

	dispose(): void {
		this._onDidChange.dispose();
	}
}

/** 注册 Shelf 命令。 */
export function registerShelfCommands(service: GitRepositoryService, shelfService: ShelfService, shelfTree: ShelfTreeProvider): vscode.Disposable[] {
	const subs: vscode.Disposable[] = [];

	subs.push(
		vscode.commands.registerCommand('hyperGit.shelveChanges', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const changes = service.getChanges().filter((c) => !c.staged);
			if (changes.length === 0) {
				void vscode.window.showInformationMessage('无未暂存改动可 shelve');
				return;
			}
			const name = await vscode.window.showInputBox({ prompt: 'Shelf 名称', placeHolder: '例如 feature-x-wip' });
			if (!name || !name.trim()) {
				return;
			}
			const picks = await vscode.window.showQuickPick(
				changes.map((c) => ({ label: c.relativePath, picked: true })),
				{ canPickMany: true, title: '选择要 shelve 的文件' },
			);
			if (!picks || picks.length === 0) {
				return;
			}
			try {
				await shelfService.shelve(name.trim(), picks.map((p) => p.label), new Date().toISOString());
				shelfTree.refresh();
				void vscode.window.showInformationMessage(`已 shelve「${name.trim()}」(${picks.length} files)`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Shelve 失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.unshelveSilently', async (node?: ShelfNode) => {
			if (!node) {
				return;
			}
			try {
				await shelfService.unshelveAndDrop(node.name, false);
				shelfTree.refresh();
				void vscode.window.showInformationMessage(`已 unshelve「${node.name}」`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Unshelve 失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.unshelveWithMerge', async (node?: ShelfNode) => {
			if (!node) {
				return;
			}
			try {
				await shelfService.unshelveAndDrop(node.name, true);
				shelfTree.refresh();
				void vscode.window.showInformationMessage(`已 unshelve（3-way）「${node.name}」`);
			} catch (e) {
				if (!(await handleGitConflict(service, 'Unshelve'))) {
					void vscode.window.showErrorMessage(`Unshelve 失败：${errMsg(e)}`);
				}
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.deleteShelf', async (node?: ShelfNode) => {
			if (!node) {
				return;
			}
			const ok = await vscode.window.showWarningMessage(`删除 Shelf「${node.name}」？`, { modal: true }, '删除');
			if (ok === '删除') {
				shelfService.drop(node.name);
				shelfTree.refresh();
			}
		}),
	);

	return subs;
}
