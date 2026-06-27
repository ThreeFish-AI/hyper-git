const assert = require('assert');
const vscode = require('vscode');

suite('扩展冒烟测试', function () {
	this.timeout(30000);

	test('扩展可激活并注册 hyperGit.showVersion 命令', async () => {
		const ext = vscode.extensions.getExtension('threefish-ai.hyper-git');
		assert.ok(ext, '扩展 threefish-ai.hyper-git 未找到');
		if (!ext.isActive) {
			await ext.activate();
		}
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('hyperGit.showVersion'), '命令 hyperGit.showVersion 未注册');
	});
});
