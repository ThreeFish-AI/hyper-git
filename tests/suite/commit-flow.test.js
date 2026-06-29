const assert = require('assert');
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 真实 git 提交闭环集成测试：
 * 通过 vscode.git 公开 API 执行 add（绝对路径）+ commit，并校验 git log。
 * 这正是 CommitService.executeCommit 委托的核心机制（路径 B：消费 vscode.git API）。
 */
suite('Commit 流程（真实 git 操作）', function () {
	this.timeout(60000);

	test('vscode.git add + commit 落库，工作区随之清洁', async function () {
		const gitExt = vscode.extensions.getExtension('vscode.git');
		assert.ok(gitExt, 'vscode.git 扩展未找到');
		if (!gitExt.isActive) {
			await gitExt.activate();
		}
		const api = gitExt.exports.getAPI(1);

		// 等待 vscode.git 发现 fixture 仓库并扫描出变更
		let repo = api.repositories[0];
		for (let i = 0; i < 40; i++) {
			repo = api.repositories[0];
			if (repo) {
				try {
					await repo.status();
				} catch {
					/* ignore */
				}
				if (repo.state.workingTreeChanges.length > 0 || repo.state.untrackedChanges.length > 0) {
					break;
				}
			}
			await sleep(500);
		}
		assert.ok(repo, '未发现 git 仓库（fixture 未被 vscode.git 打开）');
		const root = repo.rootUri.fsPath;

		// 与 CommitService 一致：传绝对路径（Uri.file 要求绝对）
		await repo.add([path.join(root, 'README.md'), path.join(root, 'feature.txt')]);
		await repo.commit('feat(test): 验证提交闭环');

		const subject = cp.execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: root }).toString().trim();
		assert.strictEqual(subject, 'feat(test): 验证提交闭环');

		const status = cp.execFileSync('git', ['status', '--porcelain'], { cwd: root }).toString().trim();
		assert.strictEqual(status, '', '提交后工作区应为空');
	});

	test('amend 改写 HEAD 提交信息且不新增 commit', async function () {
		const gitExt = vscode.extensions.getExtension('vscode.git');
		const api = gitExt.exports.getAPI(1);
		const repo = api.repositories[0];
		assert.ok(repo, '仓库未就绪');
		const root = repo.rootUri.fsPath;

		const before = cp.execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: root }).toString().trim();
		fs.writeFileSync(path.join(root, 'amend.txt'), 'amend\n');
		await repo.add([path.join(root, 'amend.txt')]);
		await repo.commit('feat(test): 改写后的提交', { amend: true });

		const after = cp.execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: root }).toString().trim();
		const subject = cp.execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: root }).toString().trim();
		assert.strictEqual(after, before, 'amend 不应新增 commit 数');
		assert.strictEqual(subject, 'feat(test): 改写后的提交');
	});
});
