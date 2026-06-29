import * as crypto from 'crypto';
import * as vscode from 'vscode';
import type { GitRepositoryService } from '../git-repository-service';
import { classifyGraphChar, normalizeGraphWidth, parseGraphLog, type GraphRow } from '../../engine/log/graph-parser';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 按列着色的 lane 调色板（类 IDEA 多色 lane）。 */
const LANE_COLORS = ['#f85149', '#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#ff7b72', '#56d4dd', '#ffa657'];
const CHAR_W = 10;
const ROW_H = 22;
const NODE_R = 4.5;

/**
 * Git 提交图（WebviewPanel）—— 真实 SVG 拓扑渲染。
 *
 * 解析 `git log --graph --format=%x00%H%x00%d%x00%s`（git 已完成 lane 分配），按字符粒度渲染为 SVG：
 * `*`→可点击圆点、`|`→竖线、`/ \`→斜线、`_`→横线，按列 floor(col/2) 多色着色（类 IDEA）。
 * 点节点 → host QuickPick 提供 per-commit 操作；订阅 service.onDidChange 实时刷新。
 */
export class GraphWebview {
	private static readonly viewType = 'hyperGit.graph';

	static async open(service: GitRepositoryService): Promise<void> {
		const repo = service.repo;
		if (!repo) {
			void vscode.window.showWarningMessage('未找到 Git 仓库');
			return;
		}
		const initial = await GraphWebview.fetchGraph(service);
		if (!initial) {
			return;
		}
		const panel = vscode.window.createWebviewPanel(GraphWebview.viewType, 'Git Graph — Hyper Git', vscode.ViewColumn.Active, {
			enableScripts: true,
			retainContextWhenHidden: true,
		});
		panel.webview.html = GraphWebview.renderHtml(initial, repo.rootUri.fsPath);
		panel.webview.onDidReceiveMessage((msg) => {
			if (msg?.type === 'commit' && typeof msg.hash === 'string') {
				void GraphWebview.handleCommitClick(service, msg.hash);
			}
		});
		// 实时刷新（防抖）
		let timer: ReturnType<typeof setTimeout> | undefined;
		const sub = service.onDidChange(() => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				void GraphWebview.fetchGraph(service).then((g) => {
					if (g && panel.visible) {
						panel.webview.html = GraphWebview.renderHtml(g, repo.rootUri.fsPath);
					}
				});
			}, 400);
		});
		panel.onDidDispose(() => {
			clearTimeout(timer);
			sub.dispose();
		});
	}

	private static async fetchGraph(service: GitRepositoryService): Promise<string | undefined> {
		try {
			return await service.execGit(['log', '--graph', '-n', '300', '--all', '--format=%x00%H%x00%d%x00%s']);
		} catch (e) {
			void vscode.window.showErrorMessage(`获取提交图失败：${errMsg(e)}`);
			return undefined;
		}
	}

	private static async handleCommitClick(service: GitRepositoryService, hash: string): Promise<void> {
		const repo = service.repo;
		if (!repo) {
			return;
		}
		const pick = await vscode.window.showQuickPick(
			[
				{ label: 'Cherry-Pick 此提交', op: 'cp' },
				{ label: 'Revert 此提交', op: 'rv' },
				{ label: 'Reset 当前分支到此提交…', op: 'rs' },
				{ label: '从此提交新建分支…', op: 'nb' },
				{ label: '从此提交新建标签…', op: 'nt' },
				{ label: '查看包含此提交的分支', op: 'cb' },
				{ label: '复制 Hash', op: 'copy' },
			],
			{ placeHolder: `提交 ${hash.slice(0, 7)}` },
		);
		if (!pick) {
			return;
		}
		try {
			switch (pick.op) {
				case 'cp':
					await service.execGit(['cherry-pick', hash]);
					break;
				case 'rv':
					await service.execGit(['revert', '--no-edit', hash]);
					break;
				case 'rs':
					await vscode.commands.executeCommand('hyperGit.resetToHere', { kind: 'commit', commit: { hash, message: '', parents: [] } });
					return;
				case 'nb': {
					const name = await vscode.window.showInputBox({ prompt: `从 ${hash.slice(0, 7)} 新建并检出分支`, placeHolder: '新分支名' });
					if (name?.trim()) {
						await repo.createBranch(name.trim(), true, hash);
					}
					break;
				}
				case 'nt': {
					const name = await vscode.window.showInputBox({ prompt: '标签名', placeHolder: '如 v1.0.0' });
					if (name?.trim()) {
						await service.execGit(['tag', name.trim(), hash]);
					}
					break;
				}
				case 'cb': {
					const out = await service.execGit(['branch', '--contains', hash]);
					const doc = await vscode.workspace.openTextDocument({ content: `$ git branch --contains ${hash.slice(0, 7)}\n\n${out}`, language: 'plaintext' });
					await vscode.window.showTextDocument(doc, { preview: true });
					return;
				}
				case 'copy':
					await vscode.env.clipboard.writeText(hash);
					void vscode.window.showInformationMessage(`已复制 ${hash.slice(0, 7)}`);
					return;
			}
			void vscode.window.showInformationMessage(`已完成：${pick.label}`);
		} catch (e) {
			void vscode.window.showErrorMessage(`操作失败：${errMsg(e)}`);
		}
	}

	private static renderHtml(graphOutput: string, repoRoot: string): string {
		const nonce = crypto.randomBytes(16).toString('base64');
		const rows = parseGraphLog(graphOutput);
		const padded = normalizeGraphWidth(rows);
		const graphWidth = (padded[0]?.length ?? 0) * CHAR_W;
		const height = rows.length * ROW_H + 8;
		const body = GraphWebview.renderSvg(rows, padded, graphWidth, height);
		return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>
body { margin: 0; padding: 12px 16px; font-family: var(--vscode-editor-font-family), ui-monospace, Menlo, Consolas, monospace; font-size: 12px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
h3 { margin: 0 0 4px; font-weight: 600; font-size: 13px; }
.repo { opacity: 0.6; font-size: 11px; margin-bottom: 8px; word-break: break-all; }
svg { display: block; }
.graph-svg { background: transparent; }
.node { cursor: pointer; fill: var(--vscode-gitDecoration-modifiedResourceForeground, #58a6ff); stroke: var(--vscode-editor-background); stroke-width: 1.5; }
.node:hover { stroke: var(--vscode-focusBorder, #007fd4); stroke-width: 2.5; }
.txt-hash { fill: var(--vscode-editorWarning-foreground, #d29922); }
.txt-ref { fill: var(--vscode-textLink-foreground, #4dabf7); font-weight: 600; }
.txt-subject { fill: var(--vscode-foreground); }
</style>
</head>
<body>
<h3>Git 提交图（最近 300 条 · 点击节点查看操作）</h3>
<div class="repo">${escapeHtml(repoRoot)}</div>
${body}
<script nonce="${nonce}">
document.querySelectorAll('.node').forEach(function(n){
  n.addEventListener('click', function(){ acquireVsCodeApi().postMessage({ type: 'commit', hash: n.getAttribute('data-hash') }); });
});
</script>
</body>
</html>`;
	}

	private static renderSvg(rows: readonly GraphRow[], padded: readonly string[], graphWidth: number, height: number): string {
		const parts: string[] = [];
		parts.push(`<svg class="graph-svg" width="${graphWidth + 600}" height="${height}" viewBox="0 0 ${graphWidth + 600} ${height}" xmlns="http://www.w3.org/2000/svg">`);
		for (let r = 0; r < rows.length; r++) {
			const y = r * ROW_H;
			const graph = padded[r] ?? '';
			for (let c = 0; c < graph.length; c++) {
				const ch = graph[c];
				const kind = classifyGraphChar(ch);
				if (kind === 'blank') {
					continue;
				}
				const x = c * CHAR_W;
				const cx = x + CHAR_W / 2;
				const color = LANE_COLORS[Math.floor(c / 2) % LANE_COLORS.length];
				switch (kind) {
					case 'node': {
						const row = rows[r];
						const dataHash = row?.hash ? ` data-hash="${escapeHtml(row.hash)}"` : '';
						parts.push(`<circle class="node" cx="${cx}" cy="${y + ROW_H / 2}" r="${NODE_R}"${dataHash} style="fill:${color}"/>`);
						break;
					}
					case 'vert':
						parts.push(`<line x1="${cx}" y1="${y}" x2="${cx}" y2="${y + ROW_H}" stroke="${color}" stroke-width="1.6"/>`);
						break;
					case 'slash':
						parts.push(`<line x1="${x}" y1="${y + ROW_H}" x2="${x + CHAR_W}" y2="${y}" stroke="${color}" stroke-width="1.6"/>`);
						break;
					case 'backslash':
						parts.push(`<line x1="${x}" y1="${y}" x2="${x + CHAR_W}" y2="${y + ROW_H}" stroke="${color}" stroke-width="1.6"/>`);
						break;
					case 'underscore':
						parts.push(`<line x1="${x}" y1="${y + ROW_H / 2}" x2="${x + CHAR_W}" y2="${y + ROW_H / 2}" stroke="${color}" stroke-width="1.6"/>`);
						break;
				}
			}
			// 文本（hash + refs + subject）
			const row = rows[r];
			if (row?.hash) {
				const tx = graphWidth + 8;
				const ty = y + ROW_H * 0.68;
				const shortHash = escapeHtml(row.hash.slice(0, 7));
				const refSpan = row.decorate ? `<tspan class="txt-ref" dx="6">${escapeHtml(row.decorate)}</tspan>` : '';
				const subj = row.subject ? `<tspan class="txt-subject" dx="6">${escapeHtml(row.subject.slice(0, 80))}</tspan>` : '';
				parts.push(`<text x="${tx}" y="${ty}" xml:space="preserve"><tspan class="txt-hash">${shortHash}</tspan>${refSpan}${subj}</text>`);
			}
		}
		parts.push('</svg>');
		return parts.join('\n');
	}
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
