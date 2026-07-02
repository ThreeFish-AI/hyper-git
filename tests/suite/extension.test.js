const assert = require('assert');
const vscode = require('vscode');
const pkg = require('../../package.json');

// 从 package.json 动态推导 extension ID（publisher.name），避免硬编码导致改名后失效。
const EXT_ID = `${pkg.publisher}.${pkg.name}`;

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
			'hyperGit.showConsole',
			'hyperGit.partialStage',
			'hyperGit.partialUnstage',
			'hyperGit.stageHunkAtCursor',
			'hyperGit.undoLastCommit',
			'hyperGit.dropCommit',
			'hyperGit.fixupCommit',
			'hyperGit.cleanupBranches',
			'hyperGit.copyBranchRef',
			'hyperGit.toggleFavorite',
			'hyperGit.checkoutAsNew',
			'hyperGit.compareWithCurrent',
			'hyperGit.tagCreate',
			'hyperGit.tagDelete',
			'hyperGit.tagCheckout',
			'hyperGit.threeWayDiff',
			'hyperGit.inlineCommitHunk',
			'hyperGit.shelveChanges',
			'hyperGit.unshelveSilently',
			'hyperGit.unshelveWithMerge',
			'hyperGit.deleteShelf',
			'hyperGit.startRebase',
			'hyperGit.moveHunkToChangelist',
		]) {
			assert.ok(commands.includes(cmd), `命令 ${cmd} 未注册`);
		}
	});
});
