import { describe, it, expect } from 'vitest';
import { authProviderId, graphqlEndpoint, isAllowedGitHubHost, isGitHubInstanceHost, parseGitHubRemote, commitWebUrl } from '../../src/engine/ci/remote-parser';

describe('parseGitHubRemote — 合法形态', () => {
	it('https（带 .git）', () => {
		expect(parseGitHubRemote('https://github.com/owner/repo.git')).toEqual({
			host: 'github.com',
			owner: 'owner',
			repo: 'repo',
			isGitHubDotCom: true,
		});
	});
	it('https（不带 .git）', () => {
		const r = parseGitHubRemote('https://github.com/ThreeFish-AI/hyper-git');
		expect(r).toMatchObject({ owner: 'ThreeFish-AI', repo: 'hyper-git', isGitHubDotCom: true });
	});
	it('https 带用户名', () => {
		expect(parseGitHubRemote('https://user@github.com/o/r.git')).toMatchObject({ owner: 'o', repo: 'r' });
	});
	it('scp 式 ssh（git@host:o/r）', () => {
		expect(parseGitHubRemote('git@github.com:owner/repo.git')).toMatchObject({ host: 'github.com', owner: 'owner', repo: 'repo' });
	});
	it('ssh:// 带端口', () => {
		expect(parseGitHubRemote('ssh://git@github.com:22/o/r.git')).toMatchObject({ host: 'github.com', owner: 'o', repo: 'r' });
	});
	it('ssh:// 不带端口', () => {
		expect(parseGitHubRemote('ssh://git@github.com/o/r')).toMatchObject({ owner: 'o', repo: 'r' });
	});
	it('GitHub Enterprise 主机', () => {
		const r = parseGitHubRemote('https://ghe.acme.com/team/proj.git');
		expect(r).toMatchObject({ host: 'ghe.acme.com', owner: 'team', repo: 'proj', isGitHubDotCom: false });
	});
	it('GHE scp 形态', () => {
		expect(parseGitHubRemote('git@ghe.acme.com:team/proj.git')).toMatchObject({ host: 'ghe.acme.com', owner: 'team', repo: 'proj' });
	});
	it('大小写主机归一', () => {
		expect(parseGitHubRemote('https://GitHub.Com/O/R.git')?.host).toBe('github.com');
	});
});

describe('parseGitHubRemote — 非法形态返回 null', () => {
	it('空串', () => {
		expect(parseGitHubRemote('')).toBeNull();
	});
	it('只有 owner 无 repo', () => {
		expect(parseGitHubRemote('https://github.com/owner')).toBeNull();
	});
	it('多段 path（wiki 等非仓库路径）', () => {
		expect(parseGitHubRemote('https://github.com/o/r/wiki')).toMatchObject({ owner: 'o', repo: 'r' });
	});
	it('乱码（非 URL）', () => {
		expect(parseGitHubRemote('not a url at all')).toBeNull();
	});
	it('非 GitHub 风格（纯文件路径）', () => {
		expect(parseGitHubRemote('/usr/local/bin')).toBeNull();
	});
});

describe('graphqlEndpoint', () => {
	it('github.com → api.github.com/graphql', () => {
		const r = parseGitHubRemote('https://github.com/o/r.git')!;
		expect(graphqlEndpoint(r)).toBe('https://api.github.com/graphql');
	});
	it('GHE → <host>/api/graphql（非 /api/v3/graphql）', () => {
		const r = parseGitHubRemote('https://ghe.acme.com/o/r.git')!;
		expect(graphqlEndpoint(r)).toBe('https://ghe.acme.com/api/graphql');
	});
});

describe('authProviderId', () => {
	it('github.com → github', () => {
		expect(authProviderId(parseGitHubRemote('https://github.com/o/r.git')!)).toBe('github');
	});
	it('GHE → github-enterprise', () => {
		expect(authProviderId(parseGitHubRemote('https://ghe.acme.com/o/r.git')!)).toBe('github-enterprise');
	});
});

describe('commitWebUrl', () => {
	it('github.com 提交页 URL', () => {
		const r = parseGitHubRemote('git@github.com:ThreeFish-AI/hyper-git.git')!;
		expect(commitWebUrl(r, '52c3624abcdef')).toBe('https://github.com/ThreeFish-AI/hyper-git/commit/52c3624abcdef');
	});
	it('GHE 主机同构（web 域，非 api）', () => {
		const r = parseGitHubRemote('https://ghe.acme.com/o/r.git')!;
		expect(commitWebUrl(r, 'deadbeef')).toBe('https://ghe.acme.com/o/r/commit/deadbeef');
	});
});

describe('isAllowedGitHubHost', () => {
	it('github.com 及其子域恒放行（大小写归一）', () => {
		expect(isAllowedGitHubHost('github.com')).toBe(true);
		expect(isAllowedGitHubHost('www.github.com')).toBe(true);
		expect(isAllowedGitHubHost('API.GitHub.com')).toBe(true);
	});
	it('相似恶意域拒绝', () => {
		expect(isAllowedGitHubHost('github.com.evil.io')).toBe(false);
		expect(isAllowedGitHubHost('notgithub.com')).toBe(false);
		expect(isAllowedGitHubHost('github.community')).toBe(false);
	});
	it('GHE 按仓库主机与 api. 前缀放行（双侧大小写归一）', () => {
		expect(isAllowedGitHubHost('ghe.acme.com', 'ghe.acme.com')).toBe(true);
		expect(isAllowedGitHubHost('api.ghe.acme.com', 'GHE.ACME.COM')).toBe(true);
		expect(isAllowedGitHubHost('ghe.other.io', 'ghe.acme.com')).toBe(false);
	});
	it('remoteHost 缺省 → 仅 github.com 域放行', () => {
		expect(isAllowedGitHubHost('github.com', undefined)).toBe(true);
		expect(isAllowedGitHubHost('ghe.acme.com', undefined)).toBe(false);
	});
});

describe('isGitHubInstanceHost', () => {
	it('github.com 恒可信（大小写归一）', () => {
		expect(isGitHubInstanceHost('github.com')).toBe(true);
		expect(isGitHubInstanceHost('GITHUB.COM')).toBe(true);
	});
	it('与已配置 GHE uri 一致的实例主机可信（host-only / 全 URL / 大小写互异形态）', () => {
		expect(isGitHubInstanceHost('ghe.acme.com', 'ghe.acme.com')).toBe(true);
		expect(isGitHubInstanceHost('ghe.acme.com', 'https://GHE.Acme.com/')).toBe(true);
	});
	it('未配置 uri 或主机不一致（含任意第三方「GitHub 形态」主机）→ 不可信', () => {
		expect(isGitHubInstanceHost('ghe.acme.com', undefined)).toBe(false);
		expect(isGitHubInstanceHost('ghe.acme.com', 'https://other.example.com')).toBe(false);
		expect(isGitHubInstanceHost('evil.example', 'ghe.acme.com')).toBe(false);
	});
	it('非法 uri 形态 → 不可信（不抛错）', () => {
		expect(isGitHubInstanceHost('ghe.acme.com', 'http://')).toBe(false);
	});
});
