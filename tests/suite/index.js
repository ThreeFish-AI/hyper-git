const path = require('path');
const Mocha = require('mocha');

/**
 * 由 @vscode/test-electron 在 Extension Development Host 内调用。
 * 收集并运行 tests/suite 下的 *.test.js。
 */
async function run() {
	const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 60000 });
	mocha.addFile(path.resolve(__dirname, 'extension.test.js'));
	mocha.addFile(path.resolve(__dirname, 'commit-flow.test.js'));

	return new Promise((resolve, reject) => {
		mocha.run((failures) => {
			if (failures > 0) {
				reject(new Error(`${failures} 个集成测试失败`));
			} else {
				resolve();
			}
		});
	});
}

module.exports = { run };
