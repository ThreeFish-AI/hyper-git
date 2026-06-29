import { describe, it, expect } from 'vitest';
import { collectBranchRefs } from '../../src/engine/ref/selection';
import type { RawRef } from '../../src/engine/ref/for-each-ref';

/** 构造测试用 RawRef。 */
function ref(shortName: string, opts: Partial<RawRef> = {}): RawRef {
	return {
		refname: `refs/heads/${shortName}`,
		shortName,
		objectname: 'abc1234',
		head: false,
		isRemote: false,
		isTag: false,
		...opts,
	};
}

const localDeletable = (r: RawRef): boolean => !r.isRemote && !r.isTag && !r.head;
const isTag = (r: RawRef): boolean => r.isTag;

describe('collectBranchRefs', () => {
	it('点击在选区内：返回过滤后的全集（多选批量）', () => {
		const a = ref('a');
		const b = ref('b');
		const c = ref('c');
		const result = collectBranchRefs(b, [a, b, c], localDeletable);
		expect(result.map((r) => r.shortName)).toEqual(['a', 'b', 'c']);
	});

	it('点击在选区外：仅作用于点击项（手势目标优先）', () => {
		const a = ref('a');
		const b = ref('b');
		const clicked = ref('z');
		// VS Code 罕见地传入不含点击项的选区 → 以点击项为准
		const result = collectBranchRefs(clicked, [a, b], localDeletable);
		expect(result.map((r) => r.shortName)).toEqual(['z']);
	});

	it('单选（选区为 [clicked]）：返回该项', () => {
		const a = ref('a');
		expect(collectBranchRefs(a, [a], localDeletable).map((r) => r.shortName)).toEqual(['a']);
	});

	it('谓词把混选收敛为本地分支（排除远程/标签/当前 HEAD）', () => {
		const local = ref('feature');
		const remote = ref('origin/feature', { isRemote: true });
		const tag = ref('v1.0', { isTag: true });
		const head = ref('main', { head: true });
		const result = collectBranchRefs(local, [local, remote, tag, head], localDeletable);
		expect(result.map((r) => r.shortName)).toEqual(['feature']);
	});

	it('isTag 谓词仅保留标签', () => {
		const tag1 = ref('v1.0', { isTag: true });
		const tag2 = ref('v2.0', { isTag: true });
		const local = ref('feature');
		const result = collectBranchRefs(tag1, [tag1, local, tag2], isTag);
		expect(result.map((r) => r.shortName)).toEqual(['v1.0', 'v2.0']);
	});

	it('按 shortName 去重', () => {
		const a1 = ref('a');
		const a2 = ref('a');
		const b = ref('b');
		expect(collectBranchRefs(a1, [a1, a2, b], localDeletable).map((r) => r.shortName)).toEqual(['a', 'b']);
	});

	it('点击项未定义（如组节点）且选区为空 → 空数组', () => {
		expect(collectBranchRefs(undefined, [], localDeletable)).toEqual([]);
	});

	it('点击项不满足谓词时不被强加（如点击当前 HEAD 删除）', () => {
		const head = ref('main', { head: true });
		expect(collectBranchRefs(head, [head], localDeletable)).toEqual([]);
	});
});
