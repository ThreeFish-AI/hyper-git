import { describe, it, expect } from 'vitest';
import { buildLogArgs } from '../../src/engine/log/log-query';
import type { LogFilter } from '../../src/engine/log/log-filter';

const noFilter: LogFilter = {};

describe('buildLogArgs — 顺序与必选项', () => {
	it('--author-date-order 置首（lane 算法依赖「子在父之上」；作者日期倒序与视图日期列对齐、跨支正确交错）', () => {
		const args = buildLogArgs(noFilter, 'all', { maxCount: 300 });
		expect(args[0]).toBe('--author-date-order');
		// 回归护栏：不得回退到 --topo-order（否则旁支提交会被成块挤到末尾，致日期列回跳）
		expect(args).not.toContain('--topo-order');
	});

	it('scope=all 用 --branches --tags --remotes（排除工具注入的内部引用）；不含 --all', () => {
		const allArgs = buildLogArgs(noFilter, 'all', { maxCount: 300 });
		expect(allArgs).toContain('--branches');
		expect(allArgs).toContain('--tags');
		expect(allArgs).toContain('--remotes');
		// 关键回归护栏：不得回退到 --all（否则 refs/conductor-* 等内部引用会污染视图）
		expect(allArgs).not.toContain('--all');
		expect(buildLogArgs(noFilter, 'current', { maxCount: 300 })).not.toContain('--all');
	});

	it('scope=checkpointer 用 --all（原始完整视图，含内部 checkpoint 引用）且不叠三件套', () => {
		const cpArgs = buildLogArgs(noFilter, 'checkpointer', { maxCount: 300 });
		expect(cpArgs).toContain('--all');
		expect(cpArgs).not.toContain('--branches');
	});

	it('max-count 与 skip', () => {
		expect(buildLogArgs(noFilter, 'all', { maxCount: 500 })).toContain('--max-count=500');
		expect(buildLogArgs(noFilter, 'all', { maxCount: 500, skip: 500 })).toContain('--skip=500');
		expect(buildLogArgs(noFilter, 'all', { maxCount: 500, skip: 0 })).not.toContain('--skip=0');
	});
});

describe('buildLogArgs — 服务端过滤翻译', () => {
	it('exact 作者翻译为锚定字面 pattern（首尾 ^$ + 全字面转义，同名异邮箱不混淆）', () => {
		const args = buildLogArgs({ authors: [{ kind: 'exact', name: 'Jane', email: 'jane@x.com' }] }, 'all', { maxCount: 300 });
		expect(args).toContain('--author=^Jane <jane@x\\.com>$');
	});

	it('多个 exact 作者产生多条 --author（git 取 OR）', () => {
		const args = buildLogArgs(
			{
				authors: [
					{ kind: 'exact', name: 'Jane', email: 'jane@x.com' },
					{ kind: 'exact', name: 'Bob', email: 'bob@x.com' },
				],
			},
			'all',
			{ maxCount: 300 },
		);
		const authorFlags = args.filter((a) => a.startsWith('--author='));
		expect(authorFlags).toHaveLength(2);
	});

	it('pattern 项原样透传（保留旧 InputBox 任意正则能力），与 exact 可混存且去重', () => {
		const exact = { kind: 'exact', name: 'Jane', email: 'jane@x.com' } as const;
		const args = buildLogArgs(
			{ authors: [{ kind: 'pattern', pattern: '  bot@example ' }, exact, exact] },
			'all',
			{ maxCount: 300 },
		);
		const authorFlags = args.filter((a) => a.startsWith('--author='));
		expect(authorFlags).toContain('--author=bot@example');
		expect(authorFlags).toHaveLength(2);
	});

	it('BRE 转义护栏：+ ? | 裸写（BRE 普通字符，\\+ 反成量词致归零命中），. [ ] \\ 转义', () => {
		const args = buildLogArgs(
			{ authors: [{ kind: 'exact', name: 'dependabot[bot]', email: '49699333+nx@users.noreply.github.com' }] },
			'all',
			{ maxCount: 300 },
		);
		const flag = args.find((a) => a.startsWith('--author='));
		expect(flag).toBe('--author=^dependabot\\[bot\\] <49699333+nx@users\\.noreply\\.github\\.com>$');
	});

	it('空 pattern / 空数组 / 全空白不产生 flag', () => {
		// 用 `--author=` / `--grep=` 精确前缀，避免与既有的 `--author-date-order` 排序 flag 误判
		expect(buildLogArgs({ authors: [] }, 'all', { maxCount: 300 }).some((a) => a.startsWith('--author='))).toBe(false);
		expect(
			buildLogArgs({ authors: [{ kind: 'pattern', pattern: '   ' }] }, 'all', { maxCount: 300 }).some((a) => a.startsWith('--author=')),
		).toBe(false);
		expect(buildLogArgs({ grep: '' }, 'all', { maxCount: 300 }).some((a) => a.startsWith('--grep='))).toBe(false);
	});

	it('grep 翻译为 flag（去空白）', () => {
		const args = buildLogArgs({ grep: '  fix  ' }, 'all', { maxCount: 300 });
		expect(args).toContain('--grep=fix');
	});

	it('path 以 pathspec 形式置于参数末尾（--format 之后）', () => {
		const args = buildLogArgs({ path: 'src/a.ts' }, 'all', { maxCount: 300 });
		const fmtIdx = args.findIndex((a) => a.startsWith('--format='));
		const pathspecSep = args.lastIndexOf('--');
		expect(pathspecSep).toBeGreaterThan(fmtIdx);
		expect(args[args.length - 1]).toBe('src/a.ts');
		expect(args[args.length - 2]).toBe('--');
	});

	it('--format 使用 LOG_GRAPH_FORMAT 契约', () => {
		const args = buildLogArgs(noFilter, 'all', { maxCount: 300 });
		expect(args).toContain(`--format=${'%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%cI%x00%s%x00%b%x1e'}`);
	});
});
