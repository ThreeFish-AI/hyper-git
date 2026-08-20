const path = require('path');
const fs = require('fs');
const os = require('os');
const cp = require('child_process');
const { runTests } = require('@vscode/test-electron');

function git(args, cwd) {
	cp.execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
}

/** 创建带待提交变更的临时 git 仓库 fixture（供 Commit 闭环集成测试）。 */
function createFixtureRepo() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-git-fixture-'));
	git(['init', '-q'], dir);
	git(['config', 'user.email', 'test@hyper-git.local'], dir);
	git(['config', 'user.name', 'Hyper Git Test'], dir);
	git(['config', 'commit.gpgsign', 'false'], dir);
	fs.writeFileSync(path.join(dir, 'README.md'), '# init\n');
	git(['add', 'README.md'], dir);
	git(['commit', '-q', '-m', 'chore: 初始提交'], dir);
	// 制造待提交变更：修改 + 新增未跟踪
	fs.writeFileSync(path.join(dir, 'README.md'), '# init\n\n修改\n');
	fs.writeFileSync(path.join(dir, 'feature.txt'), '新功能\n');
	return dir;
}

/** 创建多根工作区 fixture（repo-a/repo-b 两个独立 git 仓库 + .code-workspace，issue #107）。 */
function createFixtureWorkspace() {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-git-multiroot-'));
	const repos = ['repo-a', 'repo-b'].map((name) => {
		const dir = path.join(base, name);
		fs.mkdirSync(dir, { recursive: true });
		git(['init', '-q'], dir);
		git(['config', 'user.email', 'test@hyper-git.local'], dir);
		git(['config', 'user.name', 'Hyper Git Test'], dir);
		git(['config', 'commit.gpgsign', 'false'], dir);
		fs.writeFileSync(path.join(dir, 'README.md'), `# ${name}\n`);
		git(['add', 'README.md'], dir);
		git(['commit', '-q', '-m', `chore: ${name} 初始提交`], dir);
		// 差异化分支：供切换后断言分支列表跟随
		git(['branch', `feature/${name}`], dir);
		return dir;
	});
	const workspaceFile = path.join(base, 'multi-root.code-workspace');
	fs.writeFileSync(
		workspaceFile,
		JSON.stringify({ folders: repos.map((dir) => ({ path: dir })) }, null, 2),
	);
	return { workspaceFile, repos };
}

async function main() {
	let fixtureDir;
	let multiRoot;
	try {
		// 1) 单仓库场景（既有回归）
		fixtureDir = createFixtureRepo();
		const extensionDevelopmentPath = path.resolve(__dirname, '..');
		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath: path.resolve(__dirname, 'suite', 'index'),
			launchArgs: [fixtureDir],
		});
		// 2) 多根工作区场景（issue #107：仓库切换）
		multiRoot = createFixtureWorkspace();
		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath: path.resolve(__dirname, 'suite', 'multi-root-index'),
			launchArgs: [multiRoot.workspaceFile],
		});
	} catch (err) {
		console.error('集成测试失败:', err);
		process.exit(1);
	} finally {
		for (const dir of [fixtureDir, multiRoot && path.dirname(multiRoot.workspaceFile)]) {
			if (dir) {
				try {
					fs.rmSync(dir, { recursive: true, force: true });
				} catch {
					/* ignore */
				}
			}
		}
	}
}

main();
