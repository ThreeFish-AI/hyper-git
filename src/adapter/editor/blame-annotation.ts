import * as path from 'path';
import * as vscode from 'vscode';
import type { GitRepositoryService } from '../git-repository-service';
import { formatAnnotation, parseBlamePorcelain } from '../../engine/blame/blame-parser';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * 编辑器内 Blame 注解（逐行作者 / 日期 / 提交注解）。
 *
 * Toggle：对当前文件执行 `git blame --line-porcelain`，解析每行作者/日期，用行内
 * before 装饰渲染在每行行首（gutter 风格）。再次 toggle 关闭。切换编辑器/文档变更时清理。
 */
export class BlameAnnotationController implements vscode.Disposable {
	private readonly decoration: vscode.TextEditorDecorationType;
	private readonly annotated = new Set<string>(); // 已注解的 document uri
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
				if (this.annotated.has(e.document.uri.toString())) {
					this.clear(e.document.uri);
				}
			}),
		);
	}

	async toggle(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		const repo = this.service.repo;
		if (!editor || !repo) {
			void vscode.window.showWarningMessage('请先打开一个文件');
			return;
		}
		const key = editor.document.uri.toString();
		if (this.annotated.has(key)) {
			this.clear(editor.document.uri);
			return;
		}
		const rel = path.relative(repo.rootUri.fsPath, editor.document.uri.fsPath).split(path.sep).join('/');
		if (rel.startsWith('..') || path.isAbsolute(rel)) {
			void vscode.window.showWarningMessage('该文件不在当前仓库内');
			return;
		}
		let blame: BlameLineMap;
		try {
			const out = await this.service.execGit(['blame', '--line-porcelain', '--', rel]);
			blame = new Map(parseBlamePorcelain(out).map((b) => [b.line, b]));
		} catch (e) {
			void vscode.window.showErrorMessage(`Blame 失败：${errMsg(e)}`);
			return;
		}
		const options: vscode.DecorationOptions[] = [];
		for (let line = 0; line < editor.document.lineCount; line++) {
			const b = blame.get(line + 1);
			if (!b) {
				continue;
			}
			options.push({
				range: new vscode.Range(line, 0, line, 0),
				renderOptions: {
					before: {
						contentText: formatAnnotation(b).padEnd(28).slice(0, 28),
						fontStyle: 'italic',
					},
				},
				hoverMessage: `${b.sha.slice(0, 7)} · ${b.author}\n${b.summary}`,
			});
		}
		editor.setDecorations(this.decoration, options);
		this.annotated.add(key);
	}

	private clear(uri: vscode.Uri): void {
		const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri.toString());
		editor?.setDecorations(this.decoration, []);
		this.annotated.delete(uri.toString());
	}

	dispose(): void {
		this.decoration.dispose();
		this.disposables.forEach((d) => d.dispose());
	}
}

type BlameLineMap = Map<number, { line: number; sha: string; author: string; authorTime: number; summary: string }>;
