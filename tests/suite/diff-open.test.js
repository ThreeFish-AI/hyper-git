const assert = require('assert');
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GIT_EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * 「打开差异」集成测试：覆盖新增/删除/重命名/根提交文件在两个视图均能打开原生差异编辑器。
 * 直接对核心修复点（缺失端走 git 空树 ref）做端到端验证：
 *   1. 空树 URI 经 vscode.git 解析得到空文档（否则新增/删除文件差异在新版 VS Code 会 FileNotFound）。
 *   2. `hyperGit.openCommitFileDiff`（Graph 视图）对 A/D/R 不抛错并打开差异。
 *   3. `hyperGit.openDiff`（Commit 视图）对工作区未跟踪新增文件不抛错并打开差异。
 *
 * 注：VS Code 对 `{preview:true}` 的差异会复用预览标签页（后续差异替换而非新增），
 * 故按「标签数自增」断言不可靠；这里每例先关闭全部编辑器，再按差异标题（含文件名）匹配标签。
 */
suite('打开差异（新增/删除/重命名/根提交）', function () {
	this.timeout(60000);

	let api;
	let repo;
	let root;

	suiteSetup(async function () {
		const gitExt = vscode.extensions.getExtension('vscode.git');
		assert.ok(gitExt, 'vscode.git 扩展未找到');
		if (!gitExt.isActive) {
			await gitExt.activate();
		}
		api = gitExt.exports.getAPI(1);
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
		root = repo.rootUri.fsPath;
	});

	async function waitFor(predicate, attempts = 50) {
		for (let i = 0; i < attempts; i++) {
			if (await predicate()) {
				return true;
			}
			await sleep(200);
		}
		return false;
	}

	async function closeAllEditors() {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await sleep(300);
	}

	/** 等待出现标签标题包含 nameContains 的标签（差异标题含文件名 + hash）。 */
	async function waitForDiffTab(nameContains) {
		return waitFor(() =>
			vscode.window.tabGroups.all.some((g) => g.tabs.some((t) => (t.label || '').includes(nameContains))),
		);
	}

	test('空树 URI 解析为空文档（缺失端锚点）', async function () {
		// 任意路径 + 空树 ref 都应稳定得到空文档（与该文件是否存在/跟踪无关）。
		const emptyUri = api.toGitUri(vscode.Uri.joinPath(repo.rootUri, 'any/file.txt'), GIT_EMPTY_TREE);
		const doc = await vscode.workspace.openTextDocument(emptyUri);
		assert.strictEqual(doc.getText(), '', '空树 ref 应解析为空文档');
	});

	test('Graph 视图：新增文件打开差异不抛错', async function () {
		await closeAllEditors();
		fs.writeFileSync(path.join(root, 'added.txt'), '新增内容\n');
		cp.execFileSync('git', ['add', 'added.txt'], { cwd: root });
		cp.execFileSync('git', ['commit', '-q', '-m', 'feat: 新增 added.txt'], { cwd: root });
		const hash = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();

		await vscode.commands.executeCommand('hyperGit.openCommitFileDiff', hash, 'added.txt', 'A');
		assert.ok(await waitForDiffTab('added.txt'), '应打开 added.txt 差异');
	});

	test('Graph 视图：删除文件打开差异不抛错', async function () {
		await closeAllEditors();
		cp.execFileSync('git', ['rm', '-q', 'added.txt'], { cwd: root });
		cp.execFileSync('git', ['commit', '-q', '-m', 'chore: 删除 added.txt'], { cwd: root });
		const hash = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();

		await vscode.commands.executeCommand('hyperGit.openCommitFileDiff', hash, 'added.txt', 'D');
		assert.ok(await waitForDiffTab('added.txt'), '应打开 added.txt 差异');
	});

	test('Graph 视图：重命名文件打开差异不抛错', async function () {
		await closeAllEditors();
		// README.md 由 fixture 初始提交落库，git mv 制造可靠 rename（含 oldPath）。
		cp.execFileSync('git', ['mv', 'README.md', 'renamed.md'], { cwd: root });
		cp.execFileSync('git', ['commit', '-q', '-m', 'refactor: README 改名'], { cwd: root });
		const hash = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();

		// status=R100、oldPath=README.md：命中「重命名」分支，左端取旧路径@父、右端取新路径@本提交。
		await vscode.commands.executeCommand('hyperGit.openCommitFileDiff', hash, 'renamed.md', 'R100', 'README.md');
		assert.ok(await waitForDiffTab('renamed.md'), '应打开 renamed.md 差异');
	});

	test('Commit 视图：工作区未跟踪新增文件打开差异不抛错', async function () {
		await closeAllEditors();
		const file = path.join(root, 'untracked.txt');
		fs.writeFileSync(file, '未跟踪\n');

		// 模拟 Commit 视图点击：构造 ChangeItem（status='A' 即 FileStatus.Added）触发 openDiff。
		const change = {
			relativePath: 'untracked.txt',
			uri: vscode.Uri.file(file),
			originalUri: vscode.Uri.file(file),
			status: 'A',
			staged: false,
		};
		await vscode.commands.executeCommand('hyperGit.openDiff', change);
		assert.ok(await waitForDiffTab('untracked.txt'), '应打开 untracked.txt 差异');
	});
});
