/**
 * `git for-each-ref` 输出解析器（纯逻辑，零 vscode 依赖）。
 *
 * 目的：为 Branches 视图提供可靠的分支枚举底座。vscode.git 的 `Repository.state.refs`
 * 在视图首帧渲染时可能尚未填充（异步），且其元素是 `Ref`（无 upstream / 无 HEAD 标记）。
 * 故改用受控 CLI 通道执行 `git for-each-ref`，一次拿全字段，供 adapter 渲染与
 * Phase 1 的 upstream / ahead-behind / favorites 扩展复用。
 *
 * 配套 CLI（字段以 NUL `%00` 分隔，规避短名含空格歧义；与 {@link parseForEachRef} 字段顺序严格对应）：
 *   git for-each-ref --format=<FOR_EACH_REF_FORMAT> refs/heads refs/remotes refs/tags
 */

/** for-each-ref 的 --format 值（与 parseForEachRef 的字段顺序严格对应，勿单独修改）。 */
export const FOR_EACH_REF_FORMAT =
	'%(refname)%00%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(HEAD)';

/** 一条 ref 的解析结果。 */
export interface RawRef {
	/** 完整 refname，如 refs/heads/main / refs/remotes/origin/main / refs/tags/v1.0。 */
	readonly refname: string;
	/** 短名（%(refname:short)），如 main / origin/main / v1.0。 */
	readonly shortName: string;
	/** 短 sha（%(objectname:short)）。 */
	readonly objectname: string;
	/** 上游短名（%(upstream:short)），仅本地分支有上游时非空。 */
	readonly upstream?: string;
	/** 是否当前 HEAD（%(HEAD) 为 `*`）。 */
	readonly head: boolean;
	readonly isRemote: boolean;
	readonly isTag: boolean;
}

/** 按本地分支 / 远程分支 / 标签分组。 */
export interface GroupedRefs {
	readonly local: readonly RawRef[];
	readonly remote: readonly RawRef[];
	readonly tags: readonly RawRef[];
}

const NUL = '\x00';

/**
 * 解析 `git for-each-ref`（NUL 分隔 5 字段）输出为 RawRef[]。
 * 容错：忽略空行与字段不足的行（避免解析异常中断整个视图）。
 */
export function parseForEachRef(output: string): RawRef[] {
	const refs: RawRef[] = [];
	for (const line of output.split('\n')) {
		if (line.length === 0) {
			continue;
		}
		const parts = line.split(NUL);
		if (parts.length < 5) {
			continue;
		}
		const refname = parts[0];
		const shortName = parts[1];
		const objectname = parts[2];
		const upstream = parts[3];
		if (!refname) {
			continue;
		}
		refs.push({
			refname,
			shortName,
			objectname,
			upstream: upstream.length > 0 ? upstream : undefined,
			head: parts[4].trim() === '*',
			isRemote: refname.startsWith('refs/remotes/'),
			isTag: refname.startsWith('refs/tags/'),
		});
	}
	return refs;
}

/** 按本地 / 远程 / 标签分组。 */
export function groupByKind(refs: readonly RawRef[]): GroupedRefs {
	const local: RawRef[] = [];
	const remote: RawRef[] = [];
	const tags: RawRef[] = [];
	for (const r of refs) {
		if (r.isTag) {
			tags.push(r);
		} else if (r.isRemote) {
			remote.push(r);
		} else {
			local.push(r);
		}
	}
	return { local, remote, tags };
}
