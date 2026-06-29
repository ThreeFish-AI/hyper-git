import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { GitRepositoryService } from '../git-repository-service';
import { parseWorktreeList, type ParsedWorktree } from '../../engine/worktree/worktree-list';

/** Worktrees 视图节点：单个工作树（扁平，无分组——工作树数量通常 ≤ 个位数）。 */
export interface WorktreeNode {
	readonly kind: 'worktree';
	/** 绝对路径（跨平台原样存储，比较时归一）。 */
	readonly path: string;
	/** 名称：main 为 'main'，其余取分支名或路径 basename。 */
	readonly name: string;
	/** HEAD 的可读标识：detached 为短 sha，否则分支名（缺失则短 sha）。 */
	readonly ref: string;
	readonly isMain: boolean;
	readonly detached: boolean;
	readonly locked: boolean;
	readonly prunable: boolean;
}

/**
 * Worktrees 视图 TreeDataProvider。
 *
 * 数据源策略（对齐 StashTreeProvider）：vscode.git 稳定 API 未暴露 worktree 创建/删除，
 * `RepositoryState.worktrees` 只读且版本敏感。故改用受控 CLI 通道 `git worktree list --porcelain -z`
 * 枚举真实工作树（含 main / detached / locked / prunable 标记）。
 * 构造函数自订阅 service.onDidChange 做即时刷新；带 in-flight 去重缓存避免并发重复 spawn。
 */
export class WorktreeTreeProvider implements vscode.TreeDataProvider<WorktreeNode>, vscode.Disposable {
	private readonly _onDidChange = new vscode.EventEmitter<WorktreeNode | undefined>();
	readonly onDidChangeTreeData = this._onDidChange.event;
	private readonly disposables: vscode.Disposable[] = [];
	private cache: WorktreeNode[] | undefined;
	private inFlight: Promise<WorktreeNode[]> | undefined;

	constructor(private readonly service: GitRepositoryService) {
		this.disposables.push(service.onDidChange(() => this.refresh()));
	}

	refresh(): void {
		this.cache = undefined;
		this._onDidChange.fire(undefined);
	}

	async getChildren(): Promise<WorktreeNode[]> {
		const repo = this.service.repo;
		if (!repo) {
			return [];
		}
		if (this.cache) {
			return this.cache;
		}
		if (this.inFlight) {
			return this.inFlight;
		}
		this.inFlight = (async () => {
			try {
				const out = await this.service.execGit(['worktree', 'list', '--porcelain', '-z']);
				const nodes = parseWorktreeList(out).map((p) => this.toNode(p));
				this.cache = nodes;
				return nodes;
			} catch {
				return [];
			} finally {
				this.inFlight = undefined;
			}
		})();
		return this.inFlight;
	}

	private toNode(p: ParsedWorktree): WorktreeNode {
		const shortSha = p.commit.slice(0, 7);
		return {
			kind: 'worktree',
			path: p.path,
			name: p.isMain ? 'main' : (p.branch ?? path.basename(p.path)),
			ref: p.detached ? shortSha : (p.branch ?? shortSha),
			isMain: p.isMain,
			detached: p.detached,
			locked: p.locked,
			prunable: p.prunable,
		};
	}

	getTreeItem(node: WorktreeNode): vscode.TreeItem {
		const isCurrent = this.isCurrent(node);

		const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
		item.id = `worktree:${node.path}`;
		item.description = this.describe(node, isCurrent);
		item.tooltip = this.tooltip(node, isCurrent);
		item.contextValue = node.isMain ? 'hyperGit.worktreeMain' : 'hyperGit.worktree';

		const icon = node.isMain ? 'home' : node.detached ? 'git-commit' : 'git-branch';
		// prunable 警示色优先（红色 > 高亮），其次当前打开高亮，对齐 branches-tree 的 ThemeIcon 高亮范式。
		const color = node.prunable
			? new vscode.ThemeColor('gitDecoration.deletedResourceForeground')
			: isCurrent
				? new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')
				: undefined;
		item.iconPath = new vscode.ThemeIcon(icon, color);
		return item;
	}

	private describe(node: WorktreeNode, isCurrent: boolean): string {
		const parts: string[] = [];
		if (node.isMain) {
			parts.push('主');
		}
		if (isCurrent) {
			parts.push('当前');
		}
		if (node.locked) {
			parts.push('🔒');
		}
		if (node.prunable) {
			parts.push('⚠ 可清理');
		}
		parts.push(node.ref);
		return parts.join(' · ');
	}

	private tooltip(node: WorktreeNode, isCurrent: boolean): string {
		const lines: string[] = [];
		lines.push(`${node.name}${node.isMain ? '（主工作树）' : ''}${isCurrent ? '（当前打开）' : ''}`);
		lines.push(`路径：${node.path}`);
		lines.push(`HEAD：${node.ref}${node.detached ? '（detached）' : ''}`);
		if (node.locked) {
			lines.push('已锁定（防止自动清理）');
		}
		if (node.prunable) {
			lines.push('⚠ 可清理（目录已失效）');
		}
		return lines.join('\n');
	}

	/** 该节点是否当前打开的 worktree（供命令层删除/移动守护复用）。 */
	isCurrent(node: WorktreeNode): boolean {
		return isSameWorktreePath(node.path, this.service.repo?.rootUri.fsPath);
	}

	dispose(): void {
		this.disposables.forEach((d) => d.dispose());
		this._onDidChange.dispose();
	}
}

/**
 * 工作树路径归一比较：`realpathSync` 规避 macOS `/tmp` ↔ `/private/tmp` 软链漏判；
 * 路径不存在（如 prunable，目录已删除）时退回原值。`path.normalize` 后去尾部分隔符。
 */
function isSameWorktreePath(a: string, b: string | undefined): boolean {
	if (!b) {
		return false;
	}
	return normalizeWorktreePath(a) === normalizeWorktreePath(b);
}

function normalizeWorktreePath(p: string): string {
	let resolved = p;
	try {
		resolved = fs.realpathSync(p);
	} catch {
		// 路径不存在（prunable）或不可读 → 用原值（不阻断比较）。
	}
	return path.normalize(resolved).replace(/[\\/]+$/, '');
}
