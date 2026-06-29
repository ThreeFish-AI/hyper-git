import * as vscode from 'vscode';
import type { GitRepositoryService } from './git-repository-service';
import type { WorktreeNode, WorktreeTreeProvider } from './tree/worktree-tree';
import { parseWorktreeList } from '../engine/worktree/worktree-list';

/**
 * 注册 Worktree 相关命令。
 *
 * 经受控 CLI 通道 `service.execGit` 执行 `git worktree` 全生命周期操作（vscode.git 稳定 API 未暴露）。
 * 范式对齐 stash-commands：命令参数类型守卫 + try/catch + showErrorMessage + 成功后 refresh；
 * 危险/不可逆操作经 `showWarningMessage({ modal: true })` 二次确认。
 */
export function registerWorktreeCommands(service: GitRepositoryService, worktreeTree: WorktreeTreeProvider): vscode.Disposable[] {
	const subs: vscode.Disposable[] = [];
	const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

	subs.push(
		vscode.commands.registerCommand('hyperGit.worktreeRefresh', () => {
			worktreeTree.refresh();
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.worktreeAdd', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			// ① 分支模式
			const modePick = await vscode.window.showQuickPick(
				[
					{ label: '新建分支', description: '创建新分支并检出', mode: 'new' as const },
					{ label: '检出已有分支', description: '检出已存在的本地分支', mode: 'checkout' as const },
					{ label: 'Detached HEAD', description: '在指定提交/分支上 detached 检出', mode: 'detached' as const },
				],
				{ placeHolder: 'Worktree 分支模式' },
			);
			if (!modePick) {
				return;
			}

			// ② 收集分支名 / 源 ref
			let branch: string | undefined;
			let sourceRef: string | undefined;
			if (modePick.mode === 'new') {
				branch = await vscode.window.showInputBox({ prompt: '新分支名', placeHolder: 'feature/y' });
				if (!branch?.trim()) {
					return;
				}
				const start = await vscode.window.showInputBox({ prompt: '基于（start-point，留空 = HEAD）', placeHolder: 'HEAD / main / abc1234' });
				if (start === undefined) {
					return; // Esc 取消；空字符串 = HEAD（允许）
				}
				sourceRef = start.trim() || undefined;
			} else {
				// checkout / detached：枚举本地分支供选择
				let items: { label: string }[] = [];
				try {
					const list = await service.execGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
					items = list
						.split('\n')
						.map((l) => l.trim())
						.filter((l) => l.length > 0)
						.map((l) => ({ label: l }));
				} catch {
					// 列表读取失败 → 退化为空列表（下方 pick 为空时取消）
				}
				const pick = await vscode.window.showQuickPick(items, {
					placeHolder: modePick.mode === 'detached' ? '选择提交/分支（detached）' : '选择本地分支',
				});
				if (!pick) {
					return;
				}
				sourceRef = pick.label;
			}

			// ③ Worktree 路径
			const safeName = (branch ?? sourceRef ?? 'worktree').replace(/[^A-Za-z0-9._-]+/g, '-');
			const wtPath = await vscode.window.showInputBox({
				prompt: 'Worktree 路径（相对仓库根 / 绝对）',
				value: `../${safeName}-wt`,
				placeHolder: '../feature-y-wt',
			});
			if (!wtPath?.trim()) {
				return;
			}

			const args = ['worktree', 'add'];
			if (modePick.mode === 'new') {
				args.push('-b', branch!.trim());
			} else if (modePick.mode === 'detached') {
				args.push('--detach');
			}
			args.push(wtPath.trim());
			if (modePick.mode === 'new') {
				if (sourceRef) {
					args.push(sourceRef); // 可选 start-point（默认 HEAD）
				}
			} else {
				args.push(sourceRef!); // checkout / detached 必须有源 ref
			}
			try {
				await service.execGit(args);
				worktreeTree.refresh();
				void vscode.window.showInformationMessage(`已创建 Worktree：${wtPath.trim()}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`创建 Worktree 失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.worktreeOpen', async (node?: WorktreeNode) => {
			if (!node || node.kind !== 'worktree') {
				return;
			}
			// 默认新窗口打开：本项目单仓库选取模式（pickRepository 只取首个），多根同窗会破坏
			// SCM/分支/日志数据源；独立窗口符合 worktree 并行工作语义。
			await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(node.path), { forceNewWindow: true });
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.worktreeRemove', async (node?: WorktreeNode) => {
			const repo = service.repo;
			if (!repo || !node || node.kind !== 'worktree') {
				return;
			}
			if (node.isMain) {
				void vscode.window.showWarningMessage('主工作树不可删除');
				return;
			}
			if (worktreeTree.isCurrent(node)) {
				void vscode.window.showWarningMessage('当前打开的 Worktree 不可删除，请先切换到其他窗口');
				return;
			}
			const forcePick = await vscode.window.showQuickPick(
				[
					{ label: '删除', description: '含未提交改动将失败', f: false as const },
					{ label: '强制删除', description: '忽略未提交改动（不可逆）', f: true as const },
				],
				{ placeHolder: '删除 Worktree' },
			);
			if (!forcePick) {
				return;
			}
			const ok = await vscode.window.showWarningMessage(
				`删除 Worktree？\n${node.path}\n（${node.ref}）`,
				{ modal: true },
				'删除',
			);
			if (ok !== '删除') {
				return;
			}
			try {
				const args = ['worktree', 'remove'];
				if (forcePick.f) {
					args.push('--force');
				}
				args.push(node.path);
				await service.execGit(args);
				worktreeTree.refresh();
				void vscode.window.showInformationMessage(`已删除 Worktree：${node.name}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`删除 Worktree 失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.worktreeCopyPath', async (node?: WorktreeNode) => {
			if (!node || node.kind !== 'worktree') {
				return;
			}
			await vscode.env.clipboard.writeText(node.path);
			void vscode.window.showInformationMessage('已复制 Worktree 路径');
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.worktreeLock', async (node?: WorktreeNode) => {
			const repo = service.repo;
			if (!repo || !node || node.kind !== 'worktree') {
				return;
			}
			const reason = await vscode.window.showInputBox({ prompt: '锁定原因（可空）', placeHolder: '正在备份' });
			if (reason === undefined) {
				return; // Esc 取消；空字符串 = 无原因（允许）
			}
			try {
				const args = ['worktree', 'lock'];
				if (reason.trim()) {
					args.push('--reason', reason.trim());
				}
				args.push(node.path);
				await service.execGit(args);
				worktreeTree.refresh();
				void vscode.window.showInformationMessage(`已锁定 Worktree：${node.name}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`锁定 Worktree 失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.worktreeUnlock', async (node?: WorktreeNode) => {
			const repo = service.repo;
			if (!repo || !node || node.kind !== 'worktree') {
				return;
			}
			try {
				await service.execGit(['worktree', 'unlock', node.path]);
				worktreeTree.refresh();
				void vscode.window.showInformationMessage(`已解锁 Worktree：${node.name}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`解锁 Worktree 失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.worktreeMove', async (node?: WorktreeNode) => {
			const repo = service.repo;
			if (!repo || !node || node.kind !== 'worktree') {
				return;
			}
			if (node.isMain) {
				void vscode.window.showWarningMessage('主工作树不可移动');
				return;
			}
			const dest = await vscode.window.showInputBox({
				prompt: '新路径（相对仓库根 / 绝对）',
				placeHolder: '../new-location',
			});
			if (!dest?.trim()) {
				return;
			}
			try {
				await service.execGit(['worktree', 'move', node.path, dest.trim()]);
				worktreeTree.refresh();
				void vscode.window.showInformationMessage(`已移动 Worktree → ${dest.trim()}`);
			} catch (e) {
				void vscode.window.showErrorMessage(`移动 Worktree 失败：${errMsg(e)}`);
			}
		}),
	);

	subs.push(
		vscode.commands.registerCommand('hyperGit.worktreePrune', async () => {
			const repo = service.repo;
			if (!repo) {
				return;
			}
			// 不静默清理：先列出 prunable 项，无则提示；有则 modal 确认（防误删网络/移动盘合法 worktree）。
			let prunablePaths: string[];
			try {
				const out = await service.execGit(['worktree', 'list', '--porcelain', '-z']);
				prunablePaths = parseWorktreeList(out)
					.filter((p) => p.prunable)
					.map((p) => p.path);
			} catch (e) {
				void vscode.window.showErrorMessage(`读取 Worktree 列表失败：${errMsg(e)}`);
				return;
			}
			if (prunablePaths.length === 0) {
				void vscode.window.showInformationMessage('无可清理的失效 Worktree');
				return;
			}
			const ok = await vscode.window.showWarningMessage(
				`清理 ${prunablePaths.length} 个失效 Worktree 元数据？\n${prunablePaths.join('\n')}`,
				{ modal: true },
				'清理',
			);
			if (ok !== '清理') {
				return;
			}
			try {
				await service.execGit(['worktree', 'prune', '-v']);
				worktreeTree.refresh();
				void vscode.window.showInformationMessage(`已清理 ${prunablePaths.length} 个失效 Worktree`);
			} catch (e) {
				void vscode.window.showErrorMessage(`清理 Worktree 失败：${errMsg(e)}`);
			}
		}),
	);

	return subs;
}
