const assert = require('assert');
const vscode = require('vscode');
const pkg = require('../../package.json');

const EXT_ID = `${pkg.publisher}.${pkg.name}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 等待 vscode.git 发现全部 fixture 仓库（两仓库 + 状态就绪）。 */
async function waitForRepos(api, count) {
	for (let i = 0; i < 40; i++) {
		if (api.repositories.length >= count) {
			return api.repositories;
		}
		await sleep(500);
	}
	throw new Error(`仓库发现超时（${api.repositories.length}/${count}）`);
}

suite('多根工作区仓库切换（issue #107）', function () {
	this.timeout(60000);

	let ext;
	let service;

	suiteSetup(async () => {
		ext = vscode.extensions.getExtension(EXT_ID);
		assert.ok(ext, `扩展 ${EXT_ID} 未找到`);
		if (!ext.isActive) {
			await ext.activate();
		}
		// activate 返回 { service }（程序化接缝），无 git API 时为 void → 跳过整个套件。
		const exports = ext.exports;
		if (!exports || !exports.service) {
			assert.fail('activate 未导出 service 接缝');
		}
		service = exports.service;
	});

	test('selectRepository 命令已注册', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('hyperGit.selectRepository'), 'hyperGit.selectRepository 未注册');
	});

	test('活跃仓库在两个 fixture 仓库间切换且各视图刷新不炸', async () => {
		const gitExt = vscode.extensions.getExtension('vscode.git');
		if (!gitExt.isActive) {
			await gitExt.activate();
		}
		const api = gitExt.exports.getAPI(1);
		const repos = await waitForRepos(api, 2);
		const sortedRoots = repos.map((r) => r.rootUri.fsPath).sort();
		const [rootA, rootB] = sortedRoots;

		// 程序化切换（带参 = 无 UI 路径）
		assert.strictEqual(service.selectRepository(rootB), true, '切到 repoB 应成功');
		assert.strictEqual(service.repoRoot, rootB, '活跃仓库应为 repoB');

		// 切换级联后视图刷新冒烟（rebind 已同步完成，防抖刷新命令不应抛错）
		await vscode.commands.executeCommand('hyperGit.refreshLog');
		await vscode.commands.executeCommand('hyperGit.refreshBranches');
		await vscode.commands.executeCommand('hyperGit.refresh');

		// 切回
		assert.strictEqual(service.selectRepository(rootA), true, '切回 repoA 应成功');
		assert.strictEqual(service.repoRoot, rootA, '活跃仓库应为 repoA');

		// 命令通道同参数化切换（palette 入口的程序化形态）
		await vscode.commands.executeCommand('hyperGit.selectRepository', rootB);
		assert.strictEqual(service.repoRoot, rootB, '经命令切换后应为 repoB');
		await vscode.commands.executeCommand('hyperGit.selectRepository', rootA);
	});

	test('切换到不存在的仓库路径返回 false 且不炸', async () => {
		const before = service.repoRoot;
		assert.strictEqual(service.selectRepository('/nonexistent/path'), false, '不存在路径应返回 false');
		assert.strictEqual(service.repoRoot, before, '活跃仓库应保持不变');
	});

	test('listRepositories 返回两个仓库', () => {
		const roots = service.listRepositories().map((r) => r.rootPath).sort();
		assert.strictEqual(roots.length, 2, '应发现两个仓库');
	});
});
