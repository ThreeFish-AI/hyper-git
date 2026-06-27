const path = require('path');
const { runTests } = require('@vscode/test-electron');

async function main() {
	try {
		const extensionDevelopmentPath = path.resolve(__dirname, '..');
		const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');
		// 在 Extension Development Host 内运行 Mocha 集成测试。
		await runTests({ extensionDevelopmentPath, extensionTestsPath });
	} catch (err) {
		console.error('集成测试失败:', err);
		process.exit(1);
	}
}

main();
