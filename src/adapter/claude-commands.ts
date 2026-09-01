import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { defaultClaudeSettingsPath } from '../engine/agent/claude-path';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Claude Code 配置命令（Agentic Git pre-M5 预置）。
 *
 * - Set Claude Code Executable Path…：QuickPick「浏览可执行文件」/「Use system Claude Code（清空覆盖）」，
 *   写回 `hyperGit.claudeCode.executablePath`（全局作用域）。
 * - Open Claude Settings：打开 `~/.claude/settings.json`；不存在时经用户确认后创建（写入 `{}`）。
 *
 * 说明：此处仅落地配置与快捷入口，真正的 Claude Code 调用留待 M5 AI 接缝（`agent/`）实装。
 */
export function registerClaudeCommands(): vscode.Disposable[] {
	const subs: vscode.Disposable[] = [];

	subs.push(
		vscode.commands.registerCommand('hyperGit.setClaudeCodePath', async () => {
			type Item = vscode.QuickPickItem & { id: 'browse' | 'system' };
			const pick = await vscode.window.showQuickPick<Item>(
				[
					{ id: 'browse', label: '$(folder-opened) Browse for executable…' },
					{
						id: 'system',
						label: '$(discard) Use system Claude Code',
						description: 'Clear the override and auto-detect from PATH',
					},
				],
				{ placeHolder: 'Configure the Claude Code executable used by Hyper Git' },
			);
			if (!pick) {
				return;
			}
			const config = vscode.workspace.getConfiguration('hyperGit.claudeCode');
			if (pick.id === 'system') {
				await config.update('executablePath', '', vscode.ConfigurationTarget.Global);
				void vscode.window.showInformationMessage(
					'Hyper Git will use the system Claude Code (auto-detected from PATH).',
				);
				return;
			}
			const sel = await vscode.window.showOpenDialog({
				canSelectMany: false,
				canSelectFiles: true,
				canSelectFolders: false,
				title: 'Select the Claude Code executable',
			});
			if (!sel?.[0]) {
				return;
			}
			await config.update('executablePath', sel[0].fsPath, vscode.ConfigurationTarget.Global);
			void vscode.window.showInformationMessage(`Claude Code executable set to: ${sel[0].fsPath}`);
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.openClaudeSettings', async () => {
			const filePath = defaultClaudeSettingsPath(os.homedir());
			try {
				if (!fs.existsSync(filePath)) {
					const choice = await vscode.window.showInformationMessage(
						`${filePath} does not exist. Create it?`,
						{ modal: true },
						'Create',
					);
					if (choice !== 'Create') {
						return;
					}
					await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
					await fs.promises.writeFile(filePath, '{}\n', 'utf8');
				}
				const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
				await vscode.window.showTextDocument(doc);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to open Claude settings: ${errMsg(e)}`);
			}
		}),
	);

	return subs;
}
