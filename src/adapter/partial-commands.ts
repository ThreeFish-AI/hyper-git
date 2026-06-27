import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { buildPatch, parseUnifiedDiff } from '../engine/diff/hunk-parser';
import type { ChangeItem, GitRepositoryService } from './git-repository-service';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * 注册 partial / 行级提交命令（Batch 3）—— IDEA PartialChangesUtil 等价物。
 *
 * hunk 选择暂存：解析 `git diff` 为 hunks，QuickPick 勾选 → 重建 patch → `git apply --cached`。
 * 光标处 hunk 暂存：定位光标所在 hunk → 暂存该 hunk。
 */
export function registerPartialCommands(service: GitRepositoryService): vscode.Disposable[] {
	const subs: vscode.Disposable[] = [];

	/** 把 patch 经临时文件应用到 index（reverse=true 时为取消暂存）。 */
	const applyToIndex = async (patch: string, reverse: boolean): Promise<void> => {
		const tmp = path.join(os.tmpdir(), `hg-patch-${Date.now()}-${Math.random().toString(36).slice(2)}.diff`);
		fs.writeFileSync(tmp, patch);
		try {
			const args = ['apply', '--cached', '--whitespace=nowarn'];
			if (reverse) {
				args.push('--reverse');
			}
			args.push(tmp);
			await service.execGit(args);
		} finally {
			try {
				fs.unlinkSync(tmp);
			} catch {
				/* ignore */
			}
		}
	};

	const pickHunks = async (diff: string, title: string): Promise<{ indices: number[] } | undefined> => {
		const files = parseUnifiedDiff(diff);
		if (files.length === 0) {
			void vscode.window.showInformationMessage('无改动');
			return undefined;
		}
		const file = files[0];
		const picks = file.hunks.map((h, i) => ({
			label: `Hunk ${i + 1}`,
			description: h.header,
			detail: h.body.slice(0, 6).join('\n'),
			index: i,
		}));
		const sel = await vscode.window.showQuickPick(picks, { canPickMany: true, title, placeHolder: '勾选 hunk（详见 detail）' });
		if (!sel || sel.length === 0) {
			return undefined;
		}
		return { indices: sel.map((s) => s.index) };
	};

	subs.push(
		vscode.commands.registerCommand('hyperGit.partialStage', async (change?: ChangeItem) => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const rel = change?.relativePath ?? (await pickUnstagedFile(service));
			if (!rel) {
				return;
			}
			try {
				const diff = await service.execGit(['diff', '--', rel]);
				if (!diff.trim()) {
					void vscode.window.showInformationMessage('该文件无未暂存改动');
					return;
				}
				const sel = await pickHunks(diff, `暂存 hunk：${rel}`);
				if (!sel) {
					return;
				}
				const file = parseUnifiedDiff(diff)[0];
				await applyToIndex(buildPatch(file, sel.indices), false);
				void vscode.window.showInformationMessage(`已暂存 ${sel.indices.length} 个 hunk`);
			} catch (e) {
				void vscode.window.showErrorMessage(`暂存失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.partialUnstage', async (change?: ChangeItem) => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			const rel = change?.relativePath ?? (await pickStagedFile(service));
			if (!rel) {
				return;
			}
			try {
				const diff = await service.execGit(['diff', '--cached', '--', rel]);
				if (!diff.trim()) {
					void vscode.window.showInformationMessage('该文件无已暂存改动');
					return;
				}
				const sel = await pickHunks(diff, `取消暂存 hunk：${rel}`);
				if (!sel) {
					return;
				}
				const file = parseUnifiedDiff(diff)[0];
				await applyToIndex(buildPatch(file, sel.indices), true);
				void vscode.window.showInformationMessage(`已取消暂存 ${sel.indices.length} 个 hunk`);
			} catch (e) {
				void vscode.window.showErrorMessage(`取消暂存失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.stageHunkAtCursor', async () => {
			const editor = vscode.window.activeTextEditor;
			const repo = service.repo;
			if (!editor || !repo) {
				return;
			}
			const rel = repoRelative(repo.rootUri.fsPath, editor.document.uri.fsPath);
			if (!rel) {
				void vscode.window.showWarningMessage('文件不在当前仓库内');
				return;
			}
			const cursorLine = editor.selection.active.line + 1;
			try {
				const diff = await service.execGit(['diff', '--', rel]);
				const files = parseUnifiedDiff(diff);
				if (files.length === 0) {
					void vscode.window.showInformationMessage('无未暂存改动');
					return;
				}
				const file = files[0];
				const overlapping = file.hunks
					.map((h, i) => ({ h, i }))
					.filter(({ h }) => cursorLine >= h.newStart && cursorLine < h.newStart + Math.max(h.newCount, 1));
				if (overlapping.length === 0) {
					void vscode.window.showInformationMessage('光标不在改动 hunk 内');
					return;
				}
				await applyToIndex(buildPatch(file, overlapping.map((o) => o.i)), false);
				void vscode.window.showInformationMessage('已暂存光标处 hunk');
			} catch (e) {
				void vscode.window.showErrorMessage(`暂存失败：${errMsg(e)}`);
			}
		}),
	);

	return subs;
}

function repoRelative(root: string, fsPath: string): string | null {
	const rel = path.relative(root, fsPath).split(path.sep).join('/');
	return rel.startsWith('..') || path.isAbsolute(rel) ? null : rel;
}

async function pickUnstagedFile(service: GitRepositoryService): Promise<string | undefined> {
	const items = service.getChanges().filter((c) => !c.staged);
	if (items.length === 0) {
		return undefined;
	}
	const pick = await vscode.window.showQuickPick(items.map((c) => ({ label: c.relativePath })), { placeHolder: '选择文件' });
	return pick?.label;
}

async function pickStagedFile(service: GitRepositoryService): Promise<string | undefined> {
	const items = service.getChanges().filter((c) => c.staged);
	if (items.length === 0) {
		return undefined;
	}
	const pick = await vscode.window.showQuickPick(items.map((c) => ({ label: c.relativePath })), { placeHolder: '选择已暂存文件' });
	return pick?.label;
}
