import { describe, it, expect } from 'vitest';
import { buildLogArgs } from '../../src/engine/log/log-query';
import type { LogFilter } from '../../src/engine/log/log-filter';

const noFilter: LogFilter = {};

describe('buildLogArgs — 顺序与必选项', () => {
	it('--topo-order 置首（lane 算法依赖拓扑序）', () => {
		expect(buildLogArgs(noFilter, 'all', { maxCount: 300 })[0]).toBe('--topo-order');
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
	it('author / grep 翻译为 flag（去空白）', () => {
		const args = buildLogArgs({ author: '  Jane  ', grep: 'fix' }, 'all', { maxCount: 300 });
		expect(args).toContain('--author=Jane');
		expect(args).toContain('--grep=fix');
	});

	it('空 author/grep 不产生 flag', () => {
		const args = buildLogArgs({ author: '   ', grep: '' }, 'all', { maxCount: 300 });
		expect(args.some((a) => a.startsWith('--author'))).toBe(false);
		expect(args.some((a) => a.startsWith('--grep'))).toBe(false);
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
		expect(args).toContain(`--format=${'%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x1e'}`);
	});
});
