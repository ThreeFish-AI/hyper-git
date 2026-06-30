/**
 * Git 远程 URL → GitHub 坐标解析（纯逻辑，零 vscode/网络依赖）。
 *
 * Log 视图的 CI 数据只存在于 GitHub，需先把仓库远程映射为 `{host, owner, repo}` 才能
 * 调用 GraphQL。本模块只回答「这个 URL 是否长得像 GitHub 坐标」——不硬编码 github.com，
 * GHE 主机亦接受；「是否真的去访问该主机」是策略，交由 adapter 层（机制/策略分离），
 * 使 GHE 支持无需改解析器。
 */

/** 解析出的 GitHub 坐标。 */
export interface GitHubRemote {
	/** 主机（小写，github.com 或 GHE 主机，如 ghe.acme.com）。 */
	readonly host: string;
	readonly owner: string;
	/** 仓库名（已去除尾部 `.git`）。 */
	readonly repo: string;
	readonly isGitHubDotCom: boolean;
}

/** scp 式 SSH：`git@github.com:owner/repo`（无 `://` 方案时方按此形态匹配）。 */
const SCP_RE = /^[^/:]+:([^?#]+)$/;

/** owner / repo 合法字符（GitHub 限制：字母数字 `_` `-` `.`）。 */
const NAME_RE = /^[\w.-]+$/;

/**
 * 解析 git 远程 URL 为 GitHub 坐标，非可识别形态返回 null。
 * 覆盖：https / `git@host:o/r` scp 式 / `ssh://[user@]host[:port]/` / 带/不带 `.git` / GHE 主机。
 */
export function parseGitHubRemote(input: string): GitHubRemote | null {
	const url = input?.trim();
	if (!url) {
		return null;
	}
	let host = '';
	let path = '';
	const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
	if (hasScheme) {
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			return null;
		}
		host = parsed.hostname.toLowerCase();
		path = parsed.pathname;
	} else {
		// scp 形态：`git@host:path` —— hostname 由 URL 不可靠，手动提取首个 `:` 前的部分。
		const scp = url.match(SCP_RE);
		if (!scp) {
			return null;
		}
		const colon = url.indexOf(':');
		const head = url.slice(0, colon);
		const at = head.lastIndexOf('@');
		host = (at >= 0 ? head.slice(at + 1) : head).toLowerCase();
		path = scp[1];
	}

	let p = decodeURIComponent(path).replace(/^\/+/, '').replace(/\/+$/, '');
	if (/\.git$/i.test(p)) {
		p = p.slice(0, -4);
	}
	// 去尾部 query/fragment 残片（防御性）。
	p = p.split(/[?#]/)[0];
	const seg = p.split('/');
	if (seg.length < 2) {
		return null;
	}
	const owner = seg[0];
	const repo = seg[1];
	if (!owner || !repo || !NAME_RE.test(owner) || !NAME_RE.test(repo)) {
		return null;
	}
	if (!host) {
		return null;
	}
	return { host, owner, repo, isGitHubDotCom: host === 'github.com' };
}

/**
 * 推导 GraphQL 端点。github.com → api.github.com；GHE → `<host>/api/graphql`
 * （**非** `/api/v3/graphql`，后者是 REST 路径——GHE GraphQL 为 `/api/graphql`）。一律 https。
 */
export function graphqlEndpoint(remote: GitHubRemote): string {
	return remote.isGitHubDotCom ? 'https://api.github.com/graphql' : `https://${remote.host}/api/graphql`;
}

/** 该主机对应的 VS Code 认证 provider id（github.com→`github`，其余→`github-enterprise`）。 */
export function authProviderId(remote: GitHubRemote): 'github' | 'github-enterprise' {
	return remote.isGitHubDotCom ? 'github' : 'github-enterprise';
}
