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

async function main() {
	let fixtureDir;
	try {
		fixtureDir = createFixtureRepo();
		const extensionDevelopmentPath = path.resolve(__dirname, '..');
		const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');
		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath,
			launchArgs: [fixtureDir],
		});
	} catch (err) {
		console.error('集成测试失败:', err);
		process.exit(1);
	} finally {
		if (fixtureDir) {
			try {
				fs.rmSync(fixtureDir, { recursive: true, force: true });
			} catch {
				/* ignore */
			}
		}
	}
}

main();
