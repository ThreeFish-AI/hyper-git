import * as path from 'path';
import * as vscode from 'vscode';
import type { GitRepositoryService } from '../git-repository-service';
import { formatAnnotation, parseBlamePorcelain } from '../../engine/blame/blame-parser';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * 编辑器内 Blame 注解（逐行作者 / 日期 / 提交注解）。
 *
 * Toggle：对当前文件执行 `git blame --line-porcelain`，解析每行作者/日期，用行内
 * before 装饰渲染在每行行首（gutter 风格）。再次 toggle 关闭。
 * 生命周期：同一文档 split 出的每个可见编辑器都同步挂载/卸载装饰；文档在所有编辑器
 * 关闭后自动移出注解表；文档编辑（行号失配）与仓库切换时清除对应注解。
 */
export class BlameAnnotationController implements vscode.Disposable {
	private readonly decoration: vscode.TextEditorDecorationType;
	private readonly annotations = new Map<string, vscode.DecorationOptions[]>(); // uri → 装饰选项
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly service: GitRepositoryService) {
		this.decoration = vscode.window.createTextEditorDecorationType({
			before: {
				margin: '0 1em 0 0',
				color: new vscode.ThemeColor('editorCodeLens.foreground'),
			},
		});
		// 文档变更后清除注解（行号失配）
		this.disposables.push(
			vscode.workspace.onDidChangeTextDocument((e) => {
				if (this.annotations.has(e.document.uri.toString())) {
					this.clear(e.document.uri);
				}
			}),
		);
		// 可见编辑器变化：新 split 出的编辑器补挂装饰；文档全部关闭则移出注解表（防泄漏）。
		this.disposables.push(
			vscode.window.onDidChangeVisibleTextEditors((editors) => {
				const openKeys = new Set(editors.map((e) => e.document.uri.toString()));
				for (const [key, options] of this.annotations) {
					if (!openKeys.has(key)) {
						this.annotations.delete(key);
						continue;
					}
					for (const e of editors) {
						if (e.document.uri.toString() === key) {
							e.setDecorations(this.decoration, options);
						}
					}
				}
			}),
		);
		// 活跃仓库切换（issue #107）后清除注解：blame 数据属于旧仓库，不清理会残留误导。
		this.disposables.push(service.onDidChangeRepository(() => this.clearAll()));
	}

	async toggle(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		const repo = this.service.repo;
		if (!editor || !repo) {
			void vscode.window.showWarningMessage('Please open a file first');
			return;
		}
		const key = editor.document.uri.toString();
		if (this.annotations.has(key)) {
			this.clear(editor.document.uri);
			return;
		}
		const rel = path.relative(repo.rootUri.fsPath, editor.document.uri.fsPath).split(path.sep).join('/');
		if (rel.startsWith('..') || path.isAbsolute(rel)) {
			void vscode.window.showWarningMessage('This file is outside the current repository');
			return;
		}
		let blame: BlameLineMap;
		try {
			const out = await this.service.execGit(['blame', '--line-porcelain', '--', rel]);
			blame = new Map(parseBlamePorcelain(out).map((b) => [b.line, b]));
		} catch (e) {
			void vscode.window.showErrorMessage(`Blame failed: ${errMsg(e)}`);
			return;
		}
		const options: vscode.DecorationOptions[] = [];
		for (let line = 0; line < editor.document.lineCount; line++) {
			const b = blame.get(line + 1);
			if (!b) {
				continue;
			}
			// hover 用 MarkdownString.appendText：换行真实生效（纯字符串会把 \n 折叠成空格）且转义作者名/摘要中的 markdown 字符。
			const hover = new vscode.MarkdownString().appendText(`${b.sha.slice(0, 7)} · ${b.author}`).appendText('\n\n').appendText(b.summary);
			options.push({
				range: new vscode.Range(line, 0, line, 0),
				renderOptions: {
					before: {
						contentText: formatAnnotation(b).padEnd(28).slice(0, 28),
						fontStyle: 'italic',
					},
				},
				hoverMessage: hover,
			});
		}
		this.annotations.set(key, options);
		this.applyToVisibleEditors(editor.document.uri);
	}

	/** 对展示同一文档的全部可见编辑器（含 split）统一挂载当前注解。 */
	private applyToVisibleEditors(uri: vscode.Uri): void {
		const key = uri.toString();
		const options = this.annotations.get(key) ?? [];
		for (const e of vscode.window.visibleTextEditors) {
			if (e.document.uri.toString() === key) {
				e.setDecorations(this.decoration, options);
			}
		}
	}

	private clear(uri: vscode.Uri): void {
		const key = uri.toString();
		const empty: vscode.DecorationOptions[] = [];
		for (const e of vscode.window.visibleTextEditors) {
			if (e.document.uri.toString() === key) {
				e.setDecorations(this.decoration, empty);
			}
		}
		this.annotations.delete(key);
	}

	/** 清除全部注解（仓库切换时，对可见编辑器复位装饰）。 */
	private clearAll(): void {
		for (const key of [...this.annotations.keys()]) {
			this.clear(vscode.Uri.parse(key));
		}
	}

	dispose(): void {
		this.decoration.dispose();
		this.disposables.forEach((d) => d.dispose());
	}
}

type BlameLineMap = Map<number, { line: number; sha: string; author: string; authorTime: number; summary: string }>;
