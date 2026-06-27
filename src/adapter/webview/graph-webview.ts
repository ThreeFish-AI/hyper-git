import * as vscode from 'vscode';
import type { GitRepositoryService } from '../git-repository-service';

/**
 * Git 提交图（WebviewPanel）。
 *
 * 用 `git log --graph --oneline --decorate --all`（受控 CLI 通道）获取拓扑文本，在 Webview 内以
 * 等宽字体 + 语义着色渲染（graph 连线、refs、hash）——补齐 IDEA Log 提交图的可视化拓扑。
 * 完整像素级 lane-SVG 渲染作为后续增强（batch 2.x）。
 */
export class GraphWebview {
	private static readonly viewType = 'hyperGit.graph';

	static async open(service: GitRepositoryService): Promise<void> {
		const repo = service.repo;
		if (!repo) {
			void vscode.window.showWarningMessage('未找到 Git 仓库');
			return;
		}
		let graph = '';
		try {
			graph = await service.execGit(['log', '--graph', '--oneline', '--decorate', '--all', '-n', '300']);
		} catch (e) {
			void vscode.window.showErrorMessage(`获取提交图失败：${e instanceof Error ? e.message : String(e)}`);
			return;
		}

		const panel = vscode.window.createWebviewPanel(GraphWebview.viewType, 'Git Graph — Hyper Git', vscode.ViewColumn.Active, {
			enableScripts: false,
			retainContextWhenHidden: false,
		});
		panel.webview.html = GraphWebview.renderHtml(graph, repo.rootUri.fsPath);
	}

	private static renderHtml(graph: string, repoRoot: string): string {
		const lines = graph.split('\n').map(GraphWebview.renderLine).join('\n');
		return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
body { margin: 0; padding: 12px 16px; font-family: var(--vscode-editor-font-family), ui-monospace, Menlo, Consolas, monospace; font-size: var(--vscode-editor-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
h3 { margin: 0 0 8px; font-weight: 600; font-size: 13px; opacity: 0.85; }
.repo { opacity: 0.6; font-size: 11px; margin-bottom: 10px; word-break: break-all; }
pre { margin: 0; white-space: pre; line-height: 1.5; overflow-x: auto; }
.graph { color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950); }
.hash { color: var(--vscode-editorWarning-foreground, #d29922); }
.ref { color: var(--vscode-textLink-foreground, #4dabf7); font-weight: 600; }
</style>
</head>
<body>
<h3>Git 提交图（最近 300 条）</h3>
<div class="repo">${escapeHtml(repoRoot)}</div>
<pre>${lines}</pre>
</body>
</html>`;
	}

	private static renderLine(line: string): string {
		const m = line.match(/^([*|/\\_. ]+)(.*)$/);
		if (!m) {
			return escapeHtml(line);
		}
		const graphPart = escapeHtml(m[1]);
		let rest = escapeHtml(m[2]);
		rest = rest.replace(/(\([^)]*\))/g, '<span class="ref">$1</span>');
		rest = rest.replace(/\b([0-9a-f]{7,40})\b/g, '<span class="hash">$1</span>');
		return `<span class="graph">${graphPart}</span>${rest}`;
	}
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
