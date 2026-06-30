import { describe, it, expect } from 'vitest';
import { authProviderId, graphqlEndpoint, parseGitHubRemote } from '../../src/engine/ci/remote-parser';

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
