/**
 * Log 客户端过滤器（纯逻辑，零 vscode 依赖）。
 *
 * authors / path / grep 交给 `git log`（repo.log）服务端过滤；以下维度 git log 稳定 API 不支持或
 * 表达不便，改在客户端对已取回的提交做过滤：合并模式（parents）/ 日期范围（authorDate）/ message 正则。
 * engine 不依赖 vscode，故以 {@link FilterableCommit} 抽象 commit 所需字段，由 adapter 映射。
 */

export type MergeMode = 'all' | 'merge-only' | 'no-merge';

/** 客户端可施加的过滤维度（均为可选，缺省即不过滤）。 */
export interface LogClientFilter {
	readonly mergeMode?: MergeMode;
	/** 起始日期（含），按 authorDate 过滤。 */
	readonly dateFrom?: Date;
	/** 截止日期（含），按 authorDate 过滤。 */
	readonly dateTo?: Date;
	readonly messageRegex?: RegExp;
	/**
	 * 是否保留 Conductor 等 Agent 工具自动创建的 checkpoint 提交（subject 以 `checkpoint:` 开头，见
	 * {@link isCheckpointSubject}）。`false` 时剔除；缺省或 `true` 时保留。由 Log 视图 scope 驱动
	 * （Checkpointer 视图保留完整历史，All/Current 剔除以呈现干净的人类提交历史）。
	 */
	readonly keepCheckpoint?: boolean;
}

/**
 * 作者过滤项（OR 语义，git 对多条 `--author` 取并集，可与 pattern 混选）：
 * - `exact`：从仓库作者列表选中的身份，经 {@link exactAuthorPattern} 锚定字面匹配（同名异邮箱不混淆）；
 * - `pattern`：手输正则原样透传（保留旧 InputBox 的任意 pattern 能力）。
 */
export type AuthorTerm =
	| { readonly kind: 'exact'; readonly name: string; readonly email: string }
	| { readonly kind: 'pattern'; readonly pattern: string };

/** 元素级合法性判定（持久化 salvage 用）：exact 项要求 name/email 均为非空串，pattern 项要求非空 pattern。 */
function isAuthorTerm(x: unknown): x is AuthorTerm {
	if (typeof x !== 'object' || x === null) {
		return false;
	}
	const t = x as Record<string, unknown>;
	if (t.kind === 'exact') {
		return typeof t.name === 'string' && t.name.length > 0 && typeof t.email === 'string' && t.email.length > 0;
	}
	return t.kind === 'pattern' && typeof t.pattern === 'string' && t.pattern.length > 0;
}

/**
 * 解析持久化的 authors 过滤（memento JSON 串 → {@link AuthorTerm} 列表）：
 * 非字符串 / 非法 JSON / 非数组返回 undefined；元素级剔除脏项（kind 未知或缺字段），
 * 剔除后为空亦返回 undefined（与「空选 = 不过滤」的规范化一致）。脏数据免疫，永不抛异常。
 */
export function parsePersistedAuthors(raw: unknown): readonly AuthorTerm[] | undefined {
	if (typeof raw !== 'string' || raw.length === 0) {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!Array.isArray(parsed)) {
		return undefined;
	}
	const terms = parsed.filter(isAuthorTerm);
	return terms.length ? terms : undefined;
}

/** 非空字符串维度（空串规约为未设置）。 */
function nonEmptyString(x: unknown): string | undefined {
	return typeof x === 'string' && x.length > 0 ? x : undefined;
}

/** ISO 串 → 合法 Date（非串 / 空 / 不可解析返回 undefined）。 */
function validDate(x: unknown): Date | undefined {
	if (typeof x !== 'string' || x.length === 0) {
		return undefined;
	}
	const d = new Date(x);
	return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * 非 authors 过滤维度（path/grep/mergeMode/dateFrom/dateTo/messageRegex）的持久化序列化：
 * 归一化后全空（undefined 维度、空串、mergeMode 'all'）返回 undefined 即删 key；Date 经 ISO 串
 * 落盘。authors 独立成 key，不属本层（见 {@link parsePersistedAuthors}）。
 */
export function serializePersistableFilter(filter: LogFilter | undefined): string | undefined {
	if (!filter) {
		return undefined;
	}
	const out: { path?: string; grep?: string; mergeMode?: MergeMode; dateFrom?: string; dateTo?: string; messageRegex?: string } = {};
	if (filter.path) {
		out.path = filter.path;
	}
	if (filter.grep) {
		out.grep = filter.grep;
	}
	if (filter.mergeMode && filter.mergeMode !== 'all') {
		out.mergeMode = filter.mergeMode;
	}
	if (filter.dateFrom) {
		out.dateFrom = filter.dateFrom.toISOString();
	}
	if (filter.dateTo) {
		out.dateTo = filter.dateTo.toISOString();
	}
	if (filter.messageRegex) {
		out.messageRegex = filter.messageRegex;
	}
	const s = JSON.stringify(out);
	return s === '{}' ? undefined : s;
}

/**
 * 解析持久化的非 authors 过滤维度（{@link serializePersistableFilter} 的逆）：非字符串 / 非法
 * JSON / 非对象返回 undefined；逐字段校验剔除脏项（字符串非空、mergeMode 合法、日期可解析），
 * 全空 / 全脏返回 undefined（与「无过滤」规约一致）。脏数据免疫，永不抛异常。
 */
export function parsePersistedFilter(raw: unknown): LogFilter | undefined {
	if (typeof raw !== 'string' || raw.length === 0) {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (typeof parsed !== 'object' || parsed === null) {
		return undefined;
	}
	const t = parsed as Record<string, unknown>;
	const path = nonEmptyString(t.path);
	const grep = nonEmptyString(t.grep);
	const messageRegex = nonEmptyString(t.messageRegex);
	const dateFrom = validDate(t.dateFrom);
	const dateTo = validDate(t.dateTo);
	const mergeMode = t.mergeMode === 'merge-only' || t.mergeMode === 'no-merge' ? t.mergeMode : undefined;
	const filter: LogFilter = {
		...(path ? { path } : {}),
		...(grep ? { grep } : {}),
		...(mergeMode ? { mergeMode } : {}),
		...(dateFrom ? { dateFrom } : {}),
		...(dateTo ? { dateTo } : {}),
		...(messageRegex ? { messageRegex } : {}),
	};
	return Object.keys(filter).length ? filter : undefined;
}

/**
 * 判定过滤器是否存在生效维度（authors 非空，或经 {@link serializePersistableFilter} 归一化后
 * 仍有可持久化维度）——归一化口径与持久化一致（空串 / mergeMode 'all' / 空 authors 均不算生效），
 * 驱动标题栏过滤图标激活态（hyperGit.log.filterActive context key）。
 */
export function hasActiveFilter(filter: LogFilter | undefined): boolean {
	if (!filter) {
		return false;
	}
	return (filter.authors?.length ?? 0) > 0 || serializePersistableFilter(filter) !== undefined;
}

/** BRE 特殊字符集：git `--author` 缺省 POSIX BRE（非 ERE），仅 `\ . [ * ^ $` 有特殊义；
 * `+ ? | ( ) {` 在 BRE 中是普通字符，加反斜杠反成量词/分组操作符（实测 `\+` 使含 `+` 的邮箱归零命中），勿扩大转义集。 */
const BRE_SPECIAL = /[.*[\]^$\\]/g;

/** 按 BRE 语义转义字面串（`+ ? |` 等保持裸写，见 {@link BRE_SPECIAL}）。 */
export function escapeBreLiteral(s: string): string {
	return s.replace(BRE_SPECIAL, '\\$&');
}

/** exact 身份 → 锚定字面 pattern：`--author` 对 `Name <email>` 整行匹配，首尾锚定 + 全字面转义。 */
export function exactAuthorPattern(name: string, email: string): string {
	return `^${escapeBreLiteral(`${name} <${email}>`)}$`;
}

/**
 * Log 完整过滤器（单一事实源，engine 层）：authors/path/grep 交 git log 服务端；
 * mergeMode/dateFrom/dateTo/messageRegex 客户端（见 {@link toClientFilter}）。
 */
export interface LogFilter {
	/** 作者过滤项集合（多选 OR），见 {@link AuthorTerm}；空/缺省即不过滤。 */
	readonly authors?: readonly AuthorTerm[];
	readonly path?: string;
	readonly grep?: string;
	readonly mergeMode?: MergeMode;
	readonly dateFrom?: Date;
	readonly dateTo?: Date;
	/** message 正则模式串（运行时经 {@link safeRegex} 编译）。 */
	readonly messageRegex?: string;
}

/** 从完整过滤器抽取客户端维度（服务端维度交 git log，见 {@link buildLogArgs}）。 */
export function toClientFilter(filter: LogFilter | undefined): LogClientFilter {
	if (!filter) {
		return {};
	}
	return {
		mergeMode: filter.mergeMode,
		dateFrom: filter.dateFrom,
		dateTo: filter.dateTo,
		messageRegex: filter.messageRegex ? safeRegex(filter.messageRegex) : undefined,
	};
}

/** 过滤所需的最小 commit 投影（adapter 由 vscode.git Commit 映射而来）。 */
export interface FilterableCommit {
	readonly message: string;
	readonly authorDate?: Date;
	readonly parents: readonly string[];
}

/** 安全构造 RegExp：空串或非法模式返回 undefined（避免过滤崩溃）。 */
export function safeRegex(pattern: string): RegExp | undefined {
	if (pattern.length === 0) {
		return undefined;
	}
	try {
		return new RegExp(pattern);
	} catch {
		return undefined;
	}
}

/**
 * Conductor 等 Agent 工具自动创建的「状态快照」提交前缀（LangGraph Checkpointer 语义）。
 * 已知模式：`checkpoint:session-<uuid>-turn-<uuid>-start/end`、`checkpoint:conductor-archive-<uuid>`、
 * `checkpoint:conductor-getdiff`。锚定 subject 行首、大小写不敏感；集中于此为单一事实源，
 * adapter / 测试一律引用本常量或谓词，杜绝识别规则分散。
 */
export const CHECKPOINT_SUBJECT_RE = /^checkpoint:/i;

/** 判定提交 subject 是否为 checkpoint 自动提交（{@link CHECKPOINT_SUBJECT_RE} 的谓词封装）。 */
export function isCheckpointSubject(subject: string): boolean {
	return CHECKPOINT_SUBJECT_RE.test(subject);
}

/** 对已取回的提交施加客户端过滤（不可变，返回新数组）。 */
export function applyClientFilters<T extends FilterableCommit>(commits: readonly T[], filter: LogClientFilter): T[] {
	let result: T[] = [...commits];
	// checkpoint 剔除置链首：其高密度特性可减少后续 mergeMode/date/regex 的计算量；
	// 与其他维度同为 AND 语义、可交换，顺序不影响结果正确性。
	if (filter.keepCheckpoint === false) {
		result = result.filter((c) => !isCheckpointSubject(c.message));
	}
	if (filter.mergeMode === 'merge-only') {
		result = result.filter((c) => c.parents.length > 1);
	} else if (filter.mergeMode === 'no-merge') {
		result = result.filter((c) => c.parents.length <= 1);
	}
	if (filter.dateFrom || filter.dateTo) {
		result = result.filter((c) => {
			if (!c.authorDate) {
				return true;
			}
			if (filter.dateFrom && c.authorDate < filter.dateFrom) {
				return false;
			}
			if (filter.dateTo && c.authorDate > filter.dateTo) {
				return false;
			}
			return true;
		});
	}
	if (filter.messageRegex) {
		const re = filter.messageRegex;
		result = result.filter((c) => re.test(c.message));
	}
	return result;
}
