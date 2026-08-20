import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { GitRepositoryService } from './git-repository-service';
import { handleGitConflict } from './conflict-ui';
import { mdTooltip, relativeDate } from './tree/tree-tooltip';
import { shelfRepoDirName } from '../engine/git-state/shelf-dir';
import { logGit } from '../infra/git-console';

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

/** Shelf 内单文件叶子（展开 shelf 节点暴露其包含的文件路径）。 */
export interface ShelfFileNode {
	readonly kind: 'file';
	readonly path: string;
}

export type ShelfTreeNode = ShelfNode | ShelfFileNode;

/**
 * ShelfService：基于 patch 的 Shelf 实现（独立于 git stash）。
 *
 * - Shelve：`git diff -- <paths>` → 存 patch 到扩展存储 → `git checkout --` 移除工作区改动（变更保留在 patch）。
 * - Unshelve：读取 patch → `git apply`（静默）或 `git apply --3way`（三方合并冲突解决）。
 * - Drop：删除 patch 文件。
 *
 * 多根仓库（issue #107）：存储按仓库隔离——`shelves/<basename>.<sha1 前 8 位>/`，
 * 目录随 `service.repoRoot` 动态求值（零快照零双源），切换仓库即切换 shelf 集。
 *
 * 与 git stash 的区别：Shelf 是命名 patch 序列（扩展存储），不占用 git stash 栈；可同时保留多个独立 shelf。
 */
export class ShelfService {
	private readonly shelvesBase: string;

	constructor(private readonly service: GitRepositoryService, storageDir: string) {
		this.shelvesBase = path.join(storageDir, 'shelves');
	}

	/** 当前活跃仓库的 shelf 目录；无 repo 时 null（调用方各自短路）。 */
	private currentDir(): string | null {
		const root = this.service.repoRoot;
		return root ? path.join(this.shelvesBase, shelfRepoDirName(root)) : null;
	}

	/**
	 * 旧版平铺目录（shelves/*.json 不分仓库）一次性安全迁移到当前仓库子目录：
	 * 仅 rename（零删除）、目标已存在即跳过（零覆盖）、失败静默可重试（已移入保留，未移入下次续迁）。
	 * 多仓库历史混仓数据无法事后归因，归属当前活跃仓库（Known Limitation）。
	 */
	private migrateLegacyShelves(targetDir: string): void {
		try {
			if (fs.existsSync(targetDir)) {
				return; // 本仓库已迁移/已使用（幂等出口）
			}
			if (!fs.existsSync(this.shelvesBase)) {
				return;
			}
			const legacyFiles = fs.readdirSync(this.shelvesBase).filter((f) => f.endsWith('.json'));
			if (legacyFiles.length === 0) {
				return;
			}
			fs.mkdirSync(targetDir, { recursive: true });
			for (const f of legacyFiles) {
				const dest = path.join(targetDir, f);
				if (fs.existsSync(dest)) {
					continue; // 绝不覆盖
				}
				fs.renameSync(path.join(this.shelvesBase, f), dest);
			}
			logGit(['shelf:migrateLegacy'], targetDir);
		} catch (e) {
			// 权限/占用等：已移入的保留（合法数据），未移入的留在原处下次重试，零数据损失。
			logGit(['shelf:migrateLegacy:failed'], undefined, errMsg(e));
		}
	}

	async shelve(name: string, paths: readonly string[], timestamp: string): Promise<void> {
		const repo = this.service.repo;
		if (!repo) {
			throw new Error('No Git repository found');
		}
		const dir = this.currentDir();
		if (!dir) {
			throw new Error('No Git repository found');
		}
		const patch = await this.service.execGit(['diff', '--', ...paths]);
		if (!patch.trim()) {
			throw new Error('Selected files have no changes (or are untracked)');
		}
		this.migrateLegacyShelves(dir);
		fs.mkdirSync(dir, { recursive: true });
		const entry: ShelfEntry = { name, paths, timestamp, patch };
		fs.writeFileSync(path.join(dir, `${sanitize(name)}.json`), JSON.stringify(entry, null, 2));
		// 移除工作区改动（变更已保存在 patch）
		await this.service.execGit(['checkout', '--', ...paths]);
	}

	async unshelve(name: string, threeWay: boolean): Promise<void> {
		const entry = this.readEntry(name);
		if (!entry) {
			throw new Error(`Shelf "${name}" does not exist`);
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
		const dir = this.currentDir();
		if (!dir) {
			return;
		}
		const file = path.join(dir, `${sanitize(name)}.json`);
		if (fs.existsSync(file)) {
			fs.unlinkSync(file);
		}
	}

	listShelves(): ShelfNode[] {
		const dir = this.currentDir();
		if (!dir) {
			return [];
		}
		this.migrateLegacyShelves(dir);
		if (!fs.existsSync(dir)) {
			return [];
		}
		return fs
			.readdirSync(dir)
			.filter((f) => f.endsWith('.json'))
			.map((f) => {
				try {
					const entry = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as ShelfEntry;
					return { kind: 'shelf' as const, name: entry.name, paths: entry.paths, timestamp: entry.timestamp };
				} catch {
					return null;
				}
			})
			.filter((n): n is ShelfNode => n !== null);
	}

	private readEntry(name: string): ShelfEntry | null {
		const dir = this.currentDir();
		if (!dir) {
			return null;
		}
		const file = path.join(dir, `${sanitize(name)}.json`);
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

/** Shelf TreeView：显示已存储的 shelf 条目，展开可见其包含的文件。 */
export class ShelfTreeProvider implements vscode.TreeDataProvider<ShelfTreeNode>, vscode.Disposable {
	private readonly _onDidChange = new vscode.EventEmitter<ShelfTreeNode | undefined>();
	readonly onDidChangeTreeData = this._onDidChange.event;

	constructor(private readonly shelfService: ShelfService) {}

	refresh(): void {
		this._onDidChange.fire(undefined);
	}

	getChildren(element?: ShelfTreeNode): ShelfTreeNode[] {
		if (!element) {
			return this.shelfService.listShelves();
		}
		if (element.kind === 'shelf') {
			return element.paths.map((p): ShelfFileNode => ({ kind: 'file', path: p }));
		}
		return [];
	}

	getTreeItem(node: ShelfTreeNode): vscode.TreeItem {
		if (node.kind === 'file') {
			const item = new vscode.TreeItem(node.path, vscode.TreeItemCollapsibleState.None);
			item.id = `shelf-file:${node.path}`;
			item.contextValue = 'hyperGit.shelfFile';
			item.tooltip = mdTooltip([['Path', node.path]]);
			return item;
		}
		const count = node.paths.length;
		const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
		item.id = `shelf:${node.name}`;
		item.description = `${count} ${count === 1 ? 'file' : 'files'} · ${relativeDate(node.timestamp)}`;
		item.contextValue = 'hyperGit.shelf';
		item.iconPath = new vscode.ThemeIcon('library');
		item.tooltip = mdTooltip(
			[
				['Files', String(count)],
				['Shelved', relativeDate(node.timestamp)],
				['Timestamp', node.timestamp],
			],
			{ title: node.name },
		);
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
				void vscode.window.showInformationMessage('No unstaged changes to shelve');
				return;
			}
			const name = await vscode.window.showInputBox({ prompt: 'Shelf name', placeHolder: 'e.g. feature-x-wip' });
			if (!name || !name.trim()) {
				return;
			}
			const picks = await vscode.window.showQuickPick(
				changes.map((c) => ({ label: c.relativePath, picked: true })),
				{ canPickMany: true, title: 'Select files to shelve' },
			);
			if (!picks || picks.length === 0) {
				return;
			}
			try {
				await shelfService.shelve(name.trim(), picks.map((p) => p.label), new Date().toISOString());
				shelfTree.refresh();
				void vscode.window.showInformationMessage(`Shelved "${name.trim()}" (${picks.length} files)`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to shelve: ${errMsg(e)}`);
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
				void vscode.window.showInformationMessage(`Unshelved "${node.name}"`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to unshelve: ${errMsg(e)}`);
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
				void vscode.window.showInformationMessage(`Unshelved "${node.name}" (3-way)`);
			} catch (e) {
				if (!(await handleGitConflict(service, 'Unshelve'))) {
					void vscode.window.showErrorMessage(`Failed to unshelve: ${errMsg(e)}`);
				}
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.deleteShelf', async (node?: ShelfNode) => {
			if (!node) {
				return;
			}
			const ok = await vscode.window.showWarningMessage(`Delete shelf "${node.name}"?`, { modal: true }, 'Delete');
			if (ok === 'Delete') {
				shelfService.drop(node.name);
				shelfTree.refresh();
			}
		}),
	);

	return subs;
}
