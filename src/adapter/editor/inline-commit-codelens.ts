import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { mapFileToEditorRegions } from '../../engine/diff/editor-mapping';
import { buildPatch, parseUnifiedDiff } from '../../engine/diff/hunk-parser';
import type { GitRepositoryService } from '../git-repository-service';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function repoRelative(root: string, fsPath: string): string | null {
	const rel = path.relative(root, fsPath).split(path.sep).join('/');
	return rel.startsWith('..') || path.isAbsolute(rel) ? null : rel;
}

/**
 * 行内提交 CodeLensProvider（IDEA editor inline commit 的 VS Code 等价）。
 *
 * 对当前文件每个未暂存 hunk，在其起始行上方渲染可点击 CodeLens「✓ 提交此 Hunk (+N -M)」。
 * 点击 → 仅暂存该 hunk（patch 重建 + `git apply --cached`）→ 输入 message → `git commit`。
 * gutter 视觉标记（绿/红/蓝）由原生 git quickDiff 提供，不重复造。
 */
export class InlineCommitCodeLensProvider implements vscode.CodeLensProvider {
	private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

	constructor(private readonly service: GitRepositoryService) {}

	refresh(): void {
		this._onDidChangeCodeLenses.fire();
	}

	async provideCodeLenses(doc: vscode.TextDocument): Promise<vscode.CodeLens[]> {
		const repo = this.service.repo;
		if (!repo) {
			return [];
		}
		const rel = repoRelative(repo.rootUri.fsPath, doc.uri.fsPath);
		if (!rel) {
			return [];
		}
		try {
			const diff = await this.service.execGit(['diff', '-U3', '--', rel]);
			if (!diff.trim()) {
				return [];
			}
			const files = parseUnifiedDiff(diff);
			if (files.length === 0) {
				return [];
			}
			const regions = mapFileToEditorRegions(files[0]);
			return regions.map((r) => {
				const line = Math.max(0, r.startLine - 1);
				return new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
					command: 'hyperGit.inlineCommitHunk',
					title: `✓ 提交此 Hunk (+${r.addedCount} -${r.removedCount})`,
					arguments: [rel, r.hunkIndex],
				});
			});
		} catch {
			return [];
		}
	}
}

/** 注册行内提交命令。 */
export function registerInlineCommitCommand(service: GitRepositoryService, provider: InlineCommitCodeLensProvider): vscode.Disposable {
	return vscode.commands.registerCommand('hyperGit.inlineCommitHunk', async (rel: string, hunkIndex: number) => {
		const repo = service.repo;
		if (!repo || !rel || hunkIndex === undefined) {
			return;
		}
		// 其他已暂存内容会一并提交——给出提示（IDEA changelist 隔离在本工具由 stage 语义承载）
		const otherStaged = service.getChanges().filter((c) => c.staged && c.relativePath !== rel);
		if (otherStaged.length > 0) {
			const ok = await vscode.window.showWarningMessage(
				`当前已有其他 ${otherStaged.length} 个已暂存文件，将一并提交。继续？`,
				{ modal: true },
				'继续提交',
			);
			if (ok !== '继续提交') {
				return;
			}
		}
		const message = await vscode.window.showInputBox({
			prompt: `提交 Hunk（${rel} #${hunkIndex + 1}）的 commit message`,
			placeHolder: 'feat(scope): description',
		});
		if (!message || !message.trim()) {
			return;
		}
		try {
			const diff = await service.execGit(['diff', '-U3', '--', rel]);
			const files = parseUnifiedDiff(diff);
			if (files.length === 0) {
				return;
			}
			const patch = buildPatch(files[0], [hunkIndex]);
			const tmp = path.join(os.tmpdir(), `hg-inline-${Date.now()}.diff`);
			fs.writeFileSync(tmp, patch);
			try {
				await service.execGit(['apply', '--cached', '--whitespace=nowarn', tmp]);
			} finally {
				try {
					fs.unlinkSync(tmp);
				} catch {
					/* ignore */
				}
			}
			await service.execGit(['commit', '-m', message.trim()]);
			provider.refresh();
			void vscode.window.showInformationMessage('已提交该 Hunk');
		} catch (e) {
			void vscode.window.showErrorMessage(`Inline commit 失败：${errMsg(e)}`);
		}
	});
}
