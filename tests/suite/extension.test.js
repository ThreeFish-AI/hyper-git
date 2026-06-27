const assert = require('assert');
const vscode = require('vscode');

const EXT_ID = 'threefish-ai.hyper-git';

suite('扩展冒烟测试', function () {
	this.timeout(30000);

	test('扩展可激活并注册全部 M1+M2+M3+M4 命令', async () => {
		const ext = vscode.extensions.getExtension(EXT_ID);
		assert.ok(ext, `扩展 ${EXT_ID} 未找到`);
		if (!ext.isActive) {
			await ext.activate();
		}
		const commands = await vscode.commands.getCommands(true);
		for (const cmd of [
			'hyperGit.showVersion',
			'hyperGit.refresh',
			'hyperGit.newChangelist',
			'hyperGit.setActiveChangelist',
			'hyperGit.renameChangelist',
			'hyperGit.deleteChangelist',
			'hyperGit.moveChangelist',
			'hyperGit.openDiff',
			'hyperGit.commit',
			'hyperGit.commitAndPush',
			'hyperGit.refreshLog',
			'hyperGit.refreshBranches',
			'hyperGit.logFilterAuthor',
			'hyperGit.logFilterPath',
			'hyperGit.logClearFilter',
			'hyperGit.copyCommitHash',
			'hyperGit.showHistory',
			'hyperGit.branchCreate',
			'hyperGit.branchCheckout',
			'hyperGit.branchDelete',
			'hyperGit.mergeBranch',
			'hyperGit.rebaseBranch',
			'hyperGit.showBlame',
			'hyperGit.stashCreate',
			'hyperGit.stashApply',
			'hyperGit.stashPop',
			'hyperGit.stashDrop',
			'hyperGit.discardChanges',
			'hyperGit.pull',
			'hyperGit.push',
			'hyperGit.fetch',
			'hyperGit.cherryPick',
			'hyperGit.revertCommit',
			'hyperGit.resetHead',
			'hyperGit.branchRename',
			'hyperGit.ignorePath',
			'hyperGit.compareBranches',
			'hyperGit.rewordCommit',
			'hyperGit.showGraph',
			'hyperGit.showConsole',
			'hyperGit.partialStage',
			'hyperGit.partialUnstage',
			'hyperGit.stageHunkAtCursor',
			'hyperGit.undoLastCommit',
			'hyperGit.dropCommit',
			'hyperGit.fixupCommit',
			'hyperGit.cleanupBranches',
			'hyperGit.copyBranchRef',
			'hyperGit.threeWayDiff',
			'hyperGit.inlineCommitHunk',
		]) {
			assert.ok(commands.includes(cmd), `命令 ${cmd} 未注册`);
		}
	});
});
