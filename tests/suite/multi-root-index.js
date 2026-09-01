const path = require('path');
const Mocha = require('mocha');

/**
 * 多根工作区场景（issue #107）：由 run-integration.js 以 multi-root.code-workspace
 * 启动 Extension Development Host 后调用，仅收集 multi-root.test.js。
 */
async function run() {
	const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 60000 });
	mocha.addFile(path.resolve(__dirname, 'multi-root.test.js'));

	return new Promise((resolve, reject) => {
		mocha.run((failures) => {
			if (failures > 0) {
				reject(new Error(`${failures} 个 multi-root 集成测试失败`));
			} else {
				resolve();
			}
		});
	});
}

module.exports = { run };
