/**
 * 差异左右端点解析（adapter 层，复用 vscode.git 的 `toGitUri` 生成 git scheme 资源）。
 *
 * 缺失端（新增文件的旧端 / 删除文件的新端）统一指向 git 空树 ref，以跨 VS Code 版本稳定地解析为空内容：
 * - 旧版（≤1.85 等）git FileSystemProvider.readFile 对任意取不到的对象容错回空；
 * - 新版对不存在对象抛 FileNotFound，仅当 ref 等于仓库空树时才回空（空树逃逸）。
 * 二者叠加使「空树 ref」成为两版皆稳的空内容来源；而具名 ref（'HEAD' / `${hash}^`）对不存在对象在新版会抛错，
 * 正是「新增/删除文件差异打不开」的根因（详见 docs/.agents/issue.md）。
 */

import type * as vscode from 'vscode';
import type { GitRepositoryService } from './git-repository-service';
import type { DiffShape } from '../engine/diff/change-side';

/**
 * git 空树对象哈希（SHA-1：`git hash-object -t tree /dev/null` 的恒定值）。
 * 缺失端指向它 → 旧版容错回空、新版空树逃逸回空，均稳定得到空文档。
 * 注：SHA-256 仓库空树哈希不同，新版空树逃逸不匹配（极少见，暂不覆盖）。
 */
export const GIT_EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** 缺失端资源 Uri：对目标路径取 git 空树 ref（稳定解析为空内容）。 */
export function emptyTreeUri(service: GitRepositoryService, uri: vscode.Uri): vscode.Uri {
	return service.toGitUri(uri, GIT_EMPTY_TREE);
}

/**
 * 依差异形态选择 [left, right]。缺失端置空树，其余端用调用方已算好的「真实内容端」。
 *
 * @param oldUri  旧端路径（重命名时为源路径），置空树时以其定位
 * @param oldSide 旧端真实内容（如 `toGitUri(oldUri, 'HEAD' | `${hash}^`)`）
 * @param newUri  新端路径，置空树时以其定位
 * @param newSide 新端真实内容（工作区 `change.uri` 或 `toGitUri(newUri, hash)`）
 */
export function resolveDiffSides(
	service: GitRepositoryService,
	shape: DiffShape,
	oldUri: vscode.Uri,
	oldSide: vscode.Uri,
	newUri: vscode.Uri,
	newSide: vscode.Uri,
): { left: vscode.Uri; right: vscode.Uri } {
	switch (shape) {
		case 'added':
			return { left: emptyTreeUri(service, newUri), right: newSide };
		case 'deleted':
			return { left: oldSide, right: emptyTreeUri(service, oldUri) };
		default:
			// renamed / modified：两端均取真实内容（重命名为异路径，修改为同路径）。
			return { left: oldSide, right: newSide };
	}
}
