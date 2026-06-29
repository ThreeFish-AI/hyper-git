import { describe, it, expect } from 'vitest';
import { parseWorktreeList } from '../../src/engine/worktree/worktree-list';

const NUL = '\x00';

/**
 * 构造一条 `git worktree list --porcelain -z` 记录。
 * -z 真实格式：每个字段后一个 NUL，记录末尾额外一个 NUL 形成空段（双 NUL）边界，整体不含 \n。
 */
function record(path: string, fields: string[]): string {
	return [`worktree ${path}`, ...fields].join(NUL) + NUL + NUL;
}

const SHA_MAIN = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const SHA_FEAT = '1111222233334444555566667777888899990000';
const SHA_DET = 'aaaabbbbccccddddeeeeffff0000111122223333';
const SHA_LOCK = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const SHA_PRUNE = 'cafecafecafecafecafecafecafecafecafecafe';

/** 真实多 worktree 仓库的完整样本（main + linked 分支 + detached + locked + prunable）。 */
const SAMPLE = [
	record('/repo/main', [`HEAD ${SHA_MAIN}`, 'branch refs/heads/main']),
	record('/repo/feature', [`HEAD ${SHA_FEAT}`, 'branch refs/heads/feature/x']),
	record('/repo/det', [`HEAD ${SHA_DET}`, 'detached']),
	record('/repo/locked', [`HEAD ${SHA_LOCK}`, 'branch refs/heads/locked-b', 'locked 正在备份']),
	record('/repo/gone', [`HEAD ${SHA_PRUNE}`, 'branch refs/heads/gone-b', 'prunable gitdir 指向已删除目录']),
].join('');

describe('parseWorktreeList', () => {
	it('解析全部 worktree 记录', () => {
		const list = parseWorktreeList(SAMPLE);
		expect(list).toHaveLength(5);
	});

	it('第一条记录标记为 main，其余非 main', () => {
		const list = parseWorktreeList(SAMPLE);
		expect(list[0].isMain).toBe(true);
		expect(list.slice(1).every((w) => w.isMain === false)).toBe(true);
	});

	it('解析绝对路径与完整 sha', () => {
		const list = parseWorktreeList(SAMPLE);
		expect(list[0].path).toBe('/repo/main');
		expect(list[0].commit).toBe(SHA_MAIN);
		expect(list[1].path).toBe('/repo/feature');
	});

	it('分支名去 refs/heads/ 前缀', () => {
		const list = parseWorktreeList(SAMPLE);
		expect(list[0].branch).toBe('main');
		expect(list[1].branch).toBe('feature/x');
	});

	it('detached 记录：无 branch 字段，detached=true，仍解析 HEAD', () => {
		const list = parseWorktreeList(SAMPLE);
		const det = list.find((w) => w.path === '/repo/det');
		expect(det?.detached).toBe(true);
		expect(det?.branch).toBeUndefined();
		expect(det?.commit).toBe(SHA_DET);
	});

	it('locked 标记（reason 同段，仅取布尔）', () => {
		const list = parseWorktreeList(SAMPLE);
		const locked = list.find((w) => w.path === '/repo/locked');
		expect(locked?.locked).toBe(true);
		expect(locked?.prunable).toBe(false);
	});

	it('prunable 标记（reason 同段，仅取布尔）', () => {
		const list = parseWorktreeList(SAMPLE);
		const gone = list.find((w) => w.path === '/repo/gone');
		expect(gone?.prunable).toBe(true);
		expect(gone?.locked).toBe(false);
	});

	it('locked 字段无 reason 时也标记 locked=true', () => {
		const out = [
			record('/r/main', [`HEAD ${SHA_MAIN}`, 'branch refs/heads/main']),
			record('/r/l', [`HEAD ${SHA_LOCK}`, 'branch refs/heads/x', 'locked']),
		].join('');
		const list = parseWorktreeList(out);
		expect(list[1].locked).toBe(true);
	});

	it('bare 仓库首块：仅 worktree + bare，isMain=true，branch=undefined，commit 为空', () => {
		const out = [
			record('/bare/repo', ['bare']),
			record('/bare/wt', [`HEAD ${SHA_MAIN}`, 'branch refs/heads/main']),
		].join('');
		const list = parseWorktreeList(out);
		expect(list).toHaveLength(2);
		expect(list[0].isMain).toBe(true);
		expect(list[0].branch).toBeUndefined();
		expect(list[0].commit).toBe('');
		expect(list[1].isMain).toBe(false);
	});

	it('容错：忽略尾部空段（record 末尾双 NUL）', () => {
		const out = record('/r/main', [`HEAD ${SHA_MAIN}`, 'branch refs/heads/main']);
		expect(parseWorktreeList(out)).toHaveLength(1);
	});

	it('容错：无 worktree 字段的孤立段不产生记录', () => {
		// 第二段只有 HEAD 字段（缺 worktree 起始），应被丢弃；仅保留第一记录
		const out = record('/r/main', [`HEAD ${SHA_MAIN}`, 'branch refs/heads/main']) + `HEAD orphan${SHA_DET}` + NUL;
		const list = parseWorktreeList(out);
		expect(list).toHaveLength(1);
		expect(list[0].path).toBe('/r/main');
	});

	it('空输入返回空数组', () => {
		expect(parseWorktreeList('')).toHaveLength(0);
	});
});
