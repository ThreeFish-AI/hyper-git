/**
 * `git worktree list --porcelain -z` 输出解析器（纯逻辑，零 vscode 依赖）。
 *
 * 目的：为 Worktrees 视图提供可靠的工作树枚举底座。vscode.git 稳定 API 未暴露 worktree 的
 * 创建/删除操作（`Repository` 接口无 createWorktree/deleteWorktree），`RepositoryState.worktrees`
 * 为只读且版本敏感。故改用受控 CLI 通道执行 `git worktree list`，一次拿全字段（含 main / detached /
 * locked / prunable 标记），供 adapter 渲染与生命周期操作复用。
 *
 * 配套 CLI（`-z` NUL 分隔，规避 locked/prunable 的 reason 含换行的歧义）：
 *   git worktree list --porcelain -z
 *
 * `-z` 输出格式（实测 git 2.x，**无 =v1/=v2 版本控制**）：每个「字段行」后跟一个 NUL，
 * 记录之间以**空段**（连续双 NUL 之间的空串）分隔——**整体不含 `\n`**。字段行语义：
 *   - `worktree <path>`：记录起始；`HEAD <sha>`；`branch refs/heads/<name>`；`detached`；
 *     `bare`；`locked [<reason>]`（reason 同字段，特殊字符时引号转义）；`prunable [<reason>]`。
 *   - 第一条有效记录即 main worktree（list 顺序保证）；bare 仓库首块仅有 `worktree`+`bare`。
 *
 * 解析策略：按 NUL 切段，逐段累积到当前记录；遇空段（记录边界）或下一条 `worktree` 段时提交当前记录。
 */

/** 一条 worktree 的解析结果。 */
export interface ParsedWorktree {
	/** 绝对路径（跨平台原样存储，比较时归一）。 */
	readonly path: string;
	/** 完整 sha（bare 块为空字符串）。 */
	readonly commit: string;
	/** 短分支名（已去 `refs/heads/` 前缀）；detached / bare 为 undefined。 */
	readonly branch: string | undefined;
	/** 是否处于 detached HEAD。 */
	readonly detached: boolean;
	/** 是否主工作树（首条记录 或 bare）。 */
	readonly isMain: boolean;
	/** 是否已锁定（防止 prune 自动清理）。 */
	readonly locked: boolean;
	/** 是否可清理（目录已失效，元数据待 prune）。 */
	readonly prunable: boolean;
}

const WT_PREFIX = 'worktree ';
const HEAD_PREFIX = 'HEAD ';
const BRANCH_PREFIX = 'branch ';
const HEADS_PREFIX = 'refs/heads/';

/**
 * 解析 `git worktree list --porcelain -z` 输出为 ParsedWorktree[]。
 * 容错：缺 `worktree` 段的孤立字段（如残块）不产生记录（hasPath 守护）；
 *      locked/prunable 的 reason 同段（`locked <reason>`），仅取布尔标记（reason 不解析）。
 * 第一条成功提交的记录即 main worktree（list 顺序保证）。
 */
export function parseWorktreeList(output: string): ParsedWorktree[] {
	const results: ParsedWorktree[] = [];
	let path = '';
	let commit = '';
	let branch: string | undefined;
	let detached = false;
	let bare = false;
	let locked = false;
	let prunable = false;
	let hasPath = false;

	const flush = (): void => {
		if (hasPath) {
			results.push({
				path,
				commit,
				branch,
				detached,
				isMain: results.length === 0 || bare,
				locked,
				prunable,
			});
		}
		path = '';
		commit = '';
		branch = undefined;
		detached = false;
		bare = false;
		locked = false;
		prunable = false;
		hasPath = false;
	};

	for (const seg of output.split('\x00')) {
		if (seg.length === 0) {
			// -z 记录边界为空段 → 提交当前记录。
			flush();
			continue;
		}
		if (seg.startsWith(WT_PREFIX)) {
			// 防御性：遇下一条 worktree 段时先提交前一条（正常情况空段已 flush）。
			if (hasPath) {
				flush();
			}
			path = seg.slice(WT_PREFIX.length);
			hasPath = true;
		} else if (seg.startsWith(HEAD_PREFIX)) {
			commit = seg.slice(HEAD_PREFIX.length);
		} else if (seg.startsWith(BRANCH_PREFIX)) {
			const ref = seg.slice(BRANCH_PREFIX.length);
			branch = ref.startsWith(HEADS_PREFIX) ? ref.slice(HEADS_PREFIX.length) : ref;
		} else if (seg === 'detached') {
			detached = true;
		} else if (seg === 'bare') {
			bare = true;
		} else if (seg === 'locked' || seg.startsWith('locked ')) {
			locked = true;
		} else if (seg === 'prunable' || seg.startsWith('prunable ')) {
			prunable = true;
		}
	}
	flush();
	return results;
}
