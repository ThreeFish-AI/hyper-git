import { describe, it, expect } from 'vitest';
import {
	resolveRemoteBranch,
	partitionRemoteByProtected,
	formatRemoteDeleteConfirm,
	isRemoteRefMissingError,
	formatRemoteDeleteResult,
} from '../../src/engine/ref/remote-ref';

describe('resolveRemoteBranch', () => {
	it('普通 remote：origin/foo → {origin, foo}', () => {
		expect(resolveRemoteBranch('origin/foo', ['origin'])).toEqual({
			remote: 'origin',
			branch: 'foo',
			shortName: 'origin/foo',
		});
	});

	it('含斜杠 remote：myorg/repo/feature → {myorg/repo, feature}（最长前缀）', () => {
		expect(resolveRemoteBranch('myorg/repo/feature', ['origin', 'myorg/repo'])).toEqual({
			remote: 'myorg/repo',
			branch: 'feature',
			shortName: 'myorg/repo/feature',
		});
	});

	it('歧义优先最长前缀（同时存在 myorg 与 myorg/repo）', () => {
		expect(resolveRemoteBranch('myorg/repo/feat', ['myorg', 'myorg/repo'])?.remote).toBe('myorg/repo');
	});

	it('前缀带分隔符防误配（origin 不应匹配 originx/foo）', () => {
		expect(resolveRemoteBranch('originx/foo', ['origin'])).toBeNull();
	});

	it('分支名自身含斜杠：origin/feat/x → {origin, feat/x}', () => {
		expect(resolveRemoteBranch('origin/feat/x', ['origin'])).toEqual({
			remote: 'origin',
			branch: 'feat/x',
			shortName: 'origin/feat/x',
		});
	});

	it('不属于任何已知 remote → null', () => {
		expect(resolveRemoteBranch('upstream/foo', ['origin'])).toBeNull();
	});

	it('纯 remote 名（无分支段）→ null', () => {
		expect(resolveRemoteBranch('origin', ['origin'])).toBeNull();
	});

	it('空 remotes → null', () => {
		expect(resolveRemoteBranch('origin/foo', [])).toBeNull();
	});
});

describe('partitionRemoteByProtected', () => {
	const t = (shortName: string, remote: string, branch: string) => ({ remote, branch, shortName });

	it('main/master 归 protected，其余 deletable', () => {
		const { deletable, protectedTargets } = partitionRemoteByProtected([
			t('origin/main', 'origin', 'main'),
			t('origin/master', 'origin', 'master'),
			t('origin/feat', 'origin', 'feat'),
		]);
		expect(deletable.map((x) => x.branch)).toEqual(['feat']);
		expect(protectedTargets.map((x) => x.branch).sort()).toEqual(['main', 'master']);
	});

	it('空输入 → 两桶皆空', () => {
		const r = partitionRemoteByProtected([]);
		expect(r.deletable).toEqual([]);
		expect(r.protectedTargets).toEqual([]);
	});

	it('分支名含斜杠的受保护判定基于末段（feat/main 不受保护）', () => {
		const { deletable } = partitionRemoteByProtected([t('origin/feat/main', 'origin', 'feat/main')]);
		expect(deletable.map((x) => x.branch)).toEqual(['feat/main']);
	});
});

describe('formatRemoteDeleteConfirm', () => {
	const t = (shortName: string, remote: string, branch: string) => ({ remote, branch, shortName });

	it('单条 → 删除 + 不可撤销 + 协作者', () => {
		const r = formatRemoteDeleteConfirm([t('origin/foo', 'origin', 'foo')]);
		expect(r.confirmLabel).toBe('Delete');
		expect(r.detail).toContain('origin/foo');
		expect(r.detail).toContain('cannot be undone');
		expect(r.detail).toContain('collaborators');
	});

	it('多条 → 含数量与截断名', () => {
		const r = formatRemoteDeleteConfirm([
			t('origin/b0', 'origin', 'b0'),
			t('origin/b1', 'origin', 'b1'),
			t('origin/b2', 'origin', 'b2'),
		]);
		expect(r.confirmLabel).toBe('Delete');
		expect(r.detail).toContain('3 remote');
	});

	it('多条超上限 → truncateNames 截断（… and N more）', () => {
		const ts = Array.from({ length: 12 }, (_, i) => t(`origin/b${i}`, 'origin', `b${i}`));
		expect(formatRemoteDeleteConfirm(ts).detail).toContain('… and 4 more');
	});

	it('含当前 HEAD 上游 → ⚠ 软警示', () => {
		const r = formatRemoteDeleteConfirm([t('origin/foo', 'origin', 'foo')], { hasUpstreamOfHead: true });
		expect(r.detail).toContain('upstream');
		expect(r.detail).toContain('⚠');
	});

	it('非 origin remote 也回显 remote 名', () => {
		const r = formatRemoteDeleteConfirm([t('upstream/bar', 'upstream', 'bar')]);
		expect(r.detail).toContain('upstream');
	});
});

describe('isRemoteRefMissingError', () => {
	// 本机 git 2.54 对「服务端已无此分支」push --delete 的实测 stderr。
	const REAL_STDERR = 'error: unable to delete \'rsi/fixture-terminology\': remote ref does not exist\nerror: failed to push some refs to \'github.com:ThreeFish-AI/rsi.git\'';

	it('实测 stderr 文案（remote ref does not exist）→ true', () => {
		const e = Object.assign(new Error('Command failed: git push'), { stderr: REAL_STDERR });
		expect(isRemoteRefMissingError(e)).toBe(true);
	});

	it('旧服务端变体（delete of non-existent ref）→ true', () => {
		expect(isRemoteRefMissingError(Object.assign(new Error('x'), { stderr: ' ! [remote rejected] foo (delete of non-existent ref)' }))).toBe(true);
	});

	it('大小写不敏感', () => {
		expect(isRemoteRefMissingError(Object.assign(new Error('x'), { stderr: 'Remote Ref Does Not Exist' }))).toBe(true);
	});

	it('无 stderr 时回退 message', () => {
		expect(isRemoteRefMissingError(new Error('unable to delete: remote ref does not exist'))).toBe(true);
	});

	it('保护分支拒绝 → false（真失败）', () => {
		const e = Object.assign(new Error('Command failed: git push'), {
			stderr: 'remote: error: refusing to delete the current branch: refs/heads/main\n ! [remote rejected] main (remote failure)',
		});
		expect(isRemoteRefMissingError(e)).toBe(false);
	});

	it('网络/认证错误等无关报错 → false', () => {
		expect(isRemoteRefMissingError(Object.assign(new Error('x'), { stderr: 'fatal: Could not read from remote repository.' }))).toBe(false);
		expect(isRemoteRefMissingError(new Error('Command failed: git push origin --delete foo'))).toBe(false);
	});

	it('非对象抛出值 / 空对象 / 空文本 → false（裸字符串走 String(e) 兜底，命中文案为 true）', () => {
		expect(isRemoteRefMissingError('remote ref does not exist')).toBe(true);
		expect(isRemoteRefMissingError('boom')).toBe(false);
		expect(isRemoteRefMissingError(null)).toBe(false);
		expect(isRemoteRefMissingError({})).toBe(false);
		expect(isRemoteRefMissingError(Object.assign(new Error(''), { stderr: '' }))).toBe(false);
		expect(isRemoteRefMissingError(Object.assign(new Error(''), { stderr: '   ' }))).toBe(false);
	});

	it('stderr 空白但 message 命中 → 回退 message（与 errMsg 守卫语义一致）', () => {
		expect(isRemoteRefMissingError(Object.assign(new Error('push: remote ref does not exist'), { stderr: '  ' }))).toBe(true);
	});
});

describe('formatRemoteDeleteResult', () => {
	const t = (shortName: string, remote = 'origin', branch = shortName.slice(remote.length + 1)) => ({ remote, branch, shortName });

	it('仅单条成功 → 单数文案 + info', () => {
		const r = formatRemoteDeleteResult([t('origin/foo')], [], []);
		expect(r).toEqual({ level: 'info', message: 'Deleted remote branch origin/foo' });
	});

	it('多条成功 → 复数计数 + info', () => {
		const r = formatRemoteDeleteResult([t('origin/a'), t('origin/b')], [], []);
		expect(r.level).toBe('info');
		expect(r.message).toBe('Deleted 2 remote branches');
	});

	it('成功 + 服务端已不存在 → 诚实并列 already gone + info', () => {
		const r = formatRemoteDeleteResult([t('origin/a')], [t('origin/rsi/fixture-terminology')], []);
		expect(r.level).toBe('info');
		expect(r.message).toBe('Deleted remote branch origin/a; 1 already gone on remote (pruned local tracking ref)');
	});

	it('仅 alreadyGone（本次报错场景：0 删除 1 陈旧）→ info 且不以 Deleted 0 开头', () => {
		const r = formatRemoteDeleteResult([], [t('origin/x')], []);
		expect(r.level).toBe('info');
		expect(r.message).toBe('1 already gone on remote (pruned local tracking ref)');
	});

	it('alreadyGone 复数 → tracking refs', () => {
		const r = formatRemoteDeleteResult([], [t('origin/x'), t('origin/y')], []);
		expect(r.message).toContain('pruned local tracking refs');
	});

	it('含失败 → error 级，附分支名与折叠后的单行原因', () => {
		const r = formatRemoteDeleteResult([t('origin/a')], [], [
			{ name: 'origin/main', reason: 'remote: error: refusing to delete the current branch\n ! [remote rejected] main (remote failure)' },
		]);
		expect(r.level).toBe('error');
		expect(r.message).toContain('1 failed: origin/main (');
		expect(r.message).toContain('refusing to delete the current branch; ! [remote rejected] main (remote failure))');
		expect(r.message).not.toContain('\n');
	});

	it('失败原因超长 → 截断加省略号', () => {
		const r = formatRemoteDeleteResult([], [], [{ name: 'origin/x', reason: `line\n${'e'.repeat(300)}` }]);
		expect(r.message.length).toBeLessThan(300);
		expect(r.message).toContain('…');
	});

	it('失败超 4 条 → 截断标注 and N more', () => {
		const failures = Array.from({ length: 6 }, (_, i) => ({ name: `origin/f${i}`, reason: 'boom' }));
		const r = formatRemoteDeleteResult([], [], failures);
		expect(r.level).toBe('error');
		expect(r.message).toContain('6 failed: ');
		expect(r.message).toContain('… and 2 more');
		expect(r.message).not.toContain('origin/f5 (');
	});

	it('三桶共存 → 一条消息完整覆盖', () => {
		const r = formatRemoteDeleteResult([t('origin/a')], [t('origin/b')], [{ name: 'origin/c', reason: 'denied' }]);
		expect(r.level).toBe('error');
		expect(r.message).toBe('Deleted remote branch origin/a; 1 already gone on remote (pruned local tracking ref); 1 failed: origin/c (denied)');
	});
});
