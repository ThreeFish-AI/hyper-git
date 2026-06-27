# IntelliJ IDEA 社区版 Git/Commit 模块 调研报告

> 调研目标：产出 IDEA「Git 工具窗口 + Commit 提交窗口」的【完整功能清单 + 关键源码锚点】，作为 VS Code 插件复刻的需求规约（Spec）基线。
> 仓库：[JetBrains/intellij-community](https://github.com/JetBrains/intellij-community)（master 分支，2025–2026 年版本）
> 官方文档：[IntelliJ IDEA Help 2026.1](https://www.jetbrains.com/help/idea/)
> 调研时间：2026-06-27

---

## A. 模块地图（源码模块职责 + 代表类）

### git4idea 插件层（`plugins/git4idea/src/git4idea/`）

| 模块 | 一句话职责 | 代表类/文件路径 |
|---|---|---|
| `checkin/` | 提交（commit）流水线：环境实现、handler 工厂、Amend、staging area 管理、commit 后转换器、push-after-commit | `GitCheckinEnvironment.kt`、`GitCheckinHandlerFactory.kt`、`GitAmendCommitService.kt`、`GitRepositoryCommitter.kt`、`GitStagingAreaStateManager.kt`、`GitCommitAndPushExecutor.kt`、`GitPushAfterCommitDialog.java`、`GitPostCommitChangeConverter.kt` |
| `commit/` | Git 提交数据模型与提交信息辅助：commit message 提供器、最近提交、签名（GPG）、合并提交信息策略 | `GitTemplateCommitMessageProvider.kt`、`GitRecentCommitsProvider.kt`、`GitCommitCompletionContributor.kt`、`signing/GpgAgentConfigurator.kt`、`signature/GitCommitSignature.kt`、`GitStagingAreaCommitMode.kt` |
| `changes/` | 变更检测与历史：committed change list、文件历史、outgoing 变更、changes 视图刷新 | `GitCommittedChangeList.java`、`GitCommittedChangeListProvider.java`、`GitFileHistory.kt`、`GitOutgoingChangesProvider.java`、`GitChangesViewRefresher.java` |
| `stash/` | Git stash 操作（push/apply/pop/drop/keep index）+ stash UI 与缓存 | `GitStashUtils.kt`（`GitStashOperations`、`loadStashStack`、`createStashHandler`）、`GitStashContentProvider.kt`、`GitStashDialog.kt`、`GitStashChangesSaver.java`、`GitStashCache.kt` |
| `branch/` | 分支操作（create/checkout/delete/rename/merge/compare）+ branches popup/dashboard | `GitBranchWorker.java`、`GitBrancherImpl.java`、`GitCheckoutOperation.java`、`GitMergeOperation.java`、`GitCreateBranchOperation.kt`、`GitCompareBranchesUi.kt`、`ui/dashboard/BranchesDashboardTreeController.kt` |
| `rebase/` | rebase（含 interactive、auto-squash、fixup、reword）+ rebase 编辑器 + 续接/中止 | `GitRebaser.java`、`GitInteractiveRebaseAction.kt`、`GitAutoSquashCommitAction.kt`、`GitRebaseProcess.java`、`interactive/GitInteractiveRebaseUsingLog.kt`、`GitRewordService.kt` |
| `rollback/` | 回滚/撤销（revert、reset、unversioned→rollback） | `GitRollbackEnvironment.java` |
| `actions/` | 顶层 Git Action 入口（branches、rebase、fetch、push-up-to-commit、working trees 等） | `GitBranchesComboBoxAction.java`、`GitRebase.java`、`GitFetch.java`、`GitPushUpToCommitAction.kt`、`actions/branch/*`、`actions/workingTree/*` |
| `ui/` | Git UI（reset 对话框、tag、stash、branches widget、merge-rebase widget、branch dashboard） | `GitResetDialog.java`、`GitTagDialog.java`、`branch/GitBranchWidget.kt`、`toolbar/GitMergeRebaseWidget.kt` |
| `push/`、`pull/`、`fetch/`、`merge/`、`cherrypick/`、`reset/`、`revert/` | 对应的 Git 命令流水线与对话框（详见各子目录） | `push/GitPushUtil.kt`、`cherrypick/GitCherryPickAction.kt`、`revert/`（commit-level revert from log） |
| `annotate/`、`diff/`、`history/` | blame 注解、diff 对比、历史浏览 | `annotate/GitAnnotationProvider.kt`、`diff/`、`history/GitHistoryUtils.kt` |
| `index/`、`status/` | staging area（index）操作与 status 计算 | `index/GitIndexUtil.kt`、`index/GitFileStatusWorker.kt` |
| `ignore/`、`vfs/`、`util/`、`console/`、`conflicts/` | gitignore、VFS 集成、工具函数、控制台、冲突解决 | `ignore/`、`conflicts/GitConflictsUtil.kt` |

### 平台层（`platform/`）

| 模块 | 一句话职责 | 代表类/文件路径 |
|---|---|---|
| `vcs-api/`（变更/提交抽象） | VCS 抽象接口：ChangeListManager、CheckinHandler、CheckinEnvironment、CommitExecutor、CommitMessageProvider、RollbackEnvironment、ChangeProvider | `changes/ChangeListManager.java`、`changes/LocalChangeList`（接口）、`checkin/CheckinHandler.java`、`checkin/CheckinEnvironment`、`changes/CommitExecutor.java`、`changes/ui/CommitMessageProvider.java` |
| `vcs-impl/`（实现） | CLM 实现、commit 对话框、shelf（shelve/unshelve）、partial changes、checkin handler 管理器、committed changes 浏览 | `changes/ChangeListManagerImpl.java`、`changes/ChangeListWorker.java`、`changes/ui/CommitChangeListDialog.java`、`changes/shelf/ShelveChangesManager.java`、`changes/shelf/ShelvedChangesViewManager.java`、`impl/PartialChangesUtil.kt`、`impl/CheckinHandlersManagerImpl.kt`、`impl/LineStatusTrackerManager.kt`、`changes/local/*`（ChangeListCommand 体系：AddList/EditName/MoveChanges/RemoveList/SetDefault） |
| `vcs-log/` | Git Log 图（graph）、过滤、搜索、cherry-pick/revert 入口 | `platform/vcs-log/`（VcsLog UI 与数据模型） |
| `dvcs-api/` | 分布式 VCS 抽象（branch、repository、working tree 通用逻辑） | `platform/dvcs-api/` |

---

## B. 功能全量矩阵（≥30 原子功能点，8 组）

> 说明：「源码锚点」优先给关键类路径；「VS Code 原生对应物」对照 VS Code 内置 SCM/Git。

### 组 1：Commit 窗口（Commit / Shelf / Stash 标签页 + 提交流水线）

| # | 功能名 | 用户可见行为 | 触发入口 | 底层 git/IDEA 机制 | 源码锚点（类路径） | 复刻难度 | VS Code 原生 |
|---|---|---|---|---|---|---|---|
| 1 | Commit 工具窗口（竖向，Alt+0） | 左侧竖向变更列表 + 提交信息区 + Diff 预览；非模态 | `Alt+0` / `Ctrl+K` | 平台 `CommitDialog/CommitToolWindow`，git4idea `GitCheckinEnvironment` | `vcs-impl/.../changes/ui/CommitChangeListDialog.java`、`DefaultCommitChangeListDialog.kt`；git4idea `checkin/GitCheckinEnvironment.kt` | 高 | 部分（SCM 面板，无竖向 commit 工具窗口形态） |
| 2 | Commit Message 模板 | 默认填充 commit message（来自 `.git/COMMIT_TEMPLATE` / `commit.template` / merge message） | 打开 commit 窗口自动填充 | `git config commit.template`；EP `com.intellij.vcs.commitMessageProvider` | `commit/GitTemplateCommitMessageProvider.kt`；`vcs-api/.../changes/ui/CommitMessageProvider.java`；`checkin/GitCheckinEnvironment.getDefaultMessageFor`（merge message） | 低 | 无原生（需插件/git config） |
| 3 | 提交信息历史与补全 | 点击历史按钮选最近提交信息；commit message 关键字补全 | 提交信息区历史按钮 / 输入触发补全 | `RecentCommitsProvider` + IDEA completion 体系 | `commit/GitRecentCommitsProvider.kt`、`GitCommitCompletionContributor.kt` | 中 | 无原生 |
| 4 | Conventional Commits 校验 | **IDEA 无内置 Conventional Commits 强校验**；仅支持 commit message 规则（wrap/reformat）与 quick-fix；需第三方插件 | 设置 `Version Control \| Commit` + quick-fix | commit message 重排（`CodeStyle`），无语义校验 | 「待核实」官方未提供 CC 校验类；参考 WebSearch 结论（需第三方） | 低（IDEA 本身无） | 无原生（需插件） |
| 5 | Amend last commit（修正上一提交） | 勾选 Amend，新改动并入上一次提交；可选指定被修正的提交 | Commit 窗口 Amend 复选框 + 下拉选择提交 | `git commit --amend`；`CommitToAmend`（Last/Specific） | `checkin/GitAmendCommitService.kt`、`GitAmendSpecificCommitSquasher.kt`；`GitCheckinEnvironment.isAmendCommitSupported/getAmendCommitDetails` | 中 | 无原生（git lens 等插件） |
| 6 | Author 覆盖 | 指定本次提交作者（name+email） | 高级选项 `Author` | `git commit --author=` | `checkin/GitCheckinEnvironment`（`myNextCommitAuthor` / `CommitContext.commitAuthor`）、`GitRepositoryCommitter` | 低 | 无原生 |
| 7 | Commit / Commit and Push | `Commit`（Ctrl+K）或 `Commit and Push`（Ctrl+Alt+K） | 按钮 / 快捷键 | commit 后可选 push；`CommitExecutor` + `GitCommitAndPushExecutor` | `checkin/GitCommitAndPushExecutor.kt`、`GitPushAfterCommitDialog.java`；`GitCheckinEnvironment.doCommit`（`commitContext.isPushAfterCommit`） | 中 | 是（Commit & Push 按钮，VS Code 1.69+） |
| 8 | Sign-off 提交 | 勾选自动追加 `Signed-off-by` | 高级选项 | `git commit -s` | `checkin/GitRepositoryCommitter`（`myNextCommitSignOff` / `commitContext.isSignOffCommit`） | 低 | 无原生 |
| 9 | Skip Git hooks（本次） | 勾选跳过本次 hook | 高级选项 `Run Git hooks` 取消 | `git commit --no-verify` | `checkin/GitSkipHooksCommitHandlerFactory.kt`、`GitCheckinEnvironment`（`myNextCommitSkipHook`） | 低 | 无原生 |
| 10 | 提交前 Inspection / 代码检查 | 勾选 Reformat/Rearrange/Optimize imports/Cleanup/Update copyright/Check TODO/Analyze code/Run Configuration 作为提交检查 | 高级选项 `Commit Checks` / `Advanced Commit Checks` | `CheckinHandler` + `CodeAnalysisBeforeCheckinHandler` + 平台 inspection/checkin factory（EP `com.intellij.checkinHandlerFactory`） | `vcs-api/.../checkin/CheckinHandler.java`；平台各 `BeforeCheckinHandler`；git4idea 自带 `GitCRLF/LargeFile/UserName/DetachedRoot/FileName CheckinHandler`（见 `GitCheckinHandlerFactory.kt`） | 高 | 无原生 |
| 11 | Commit Checks 执行顺序 | EARLY/LATE 排序，失败可阻断或后置 | 自动 | `CommitCheck.ExecutionOrder` | `checkin/GitCheckinHandlerFactory.kt`（各 handler 的 `getExecutionOrder()`） | 中 | 无 |
| 12 | CRLF / 大文件 / 用户名 / detached HEAD / 坏文件名 预检 | 提交前提示 CRLF、大文件、未设 user.name、detached HEAD、Windows 非法文件名 | 自动弹窗 | 各 `GitCheckinHandler`（`runGitCheck` 返回 `CommitProblem`） | `GitCRLFCheckinHandlerFactory`、`GitLargeFileCheckinHandlerFactory`、`GitUserNameCheckinHandlerFactory`、`GitDetachedRootCheckinHandlerFactory`、`GitFileNameCheckinHandlerFactory`（同 `GitCheckinHandlerFactory.kt`） | 中 | 无 |
| 13 | Editor 内联提交（gutter marker） | 点 gutter 变更标记 → 写 message → 提交单处改动 | gutter 变更标记工具栏 | `LineStatusTracker` + inline commit | `vcs-impl/.../impl/LineStatusTrackerManager.kt`；官方文档「Commit selected changes from the editor」 | 中 | 无原生 |
| 14 | After Commit 上传文件 | 提交后上传到部署服务器 | 高级选项 `After Commit` | 部署插件 EP | 平台 Deployment 集成（git4idea 不负责） | 低 | 无 |

### 组 2：Local Changes 变更列表（多 changelist 模型）

| # | 功能名 | 用户可见行为 | 触发入口 | 底层机制 | 源码锚点 | 复刻难度 | VS Code 原生 |
|---|---|---|---|---|---|---|---|
| 15 | 多 changelist | 同时维护多个命名变更列表 | Commit 窗口左侧树 | `ChangeListManager` + `LocalChangeList` 模型 | `vcs-api/.../changes/ChangeListManager.java`、`LocalChangeList`（接口）；`vcs-impl/.../changes/ChangeListManagerImpl.java`、`ChangeListWorker.java` | 高 | **无**（VS Code SCM 仅多 group，非命名 changelist） |
| 16 | Active changelist | 设置默认活动列表；新改动落入此列表 | `Ctrl+Space` / 右键 Set Active | `getDefaultChangeList/setDefaultChangeList`；命令 `SetDefault` | `ChangeListManager`；`changes/local/SetDefault.java` | 中 | **无**（无 active 概念） |
| 17 | 新建 changelist | `+` 新建命名列表 | `+` 按钮 / 右键 New Changelist | `ChangeListModification`；命令 `AddList` | `vcs-impl/.../changes/ui/NewChangelistDialog.java`、`NewEditChangelistPanel.kt`；`changes/local/AddList.java` | 低 | **无**（git stash/resource group 替代） |
| 18 | 删除 changelist | 删除空列表（自动清理选项） | 右键 Delete | `scheduleAutomaticEmptyChangeListDeletion`；命令 `RemoveList` | `ChangeListManager.scheduleAutomaticEmptyChangeListDeletion`；`changes/local/RemoveList.java`；设置 `REMOVE_EMPTY_INACTIVE_CHANGELISTS` | 低 | 无 |
| 19 | 重命名 changelist | 右键 Edit → 改名/改注释 | 右键 Edit Changelist | 命令 `EditName`/`EditComment` | `vcs-impl/.../changes/ui/EditChangelistDialog.java`；`changes/local/EditName.java`、`EditComment.java` | 低 | 无 |
| 20 | Move changes between changelists | `⌘⇧M`/`Alt+Shift+M` 或拖拽移动变更到其他列表 | 快捷键 / 右键 Move to Another Changelist / 拖拽 | `ChangeListModification.moveChanges`；命令 `MoveChanges` | `changes/local/MoveChanges.java`；`vcs-impl/.../changes/ui/ChangeListChooser.java` | 中 | **无** |
| 21 | Changelist 自动绑定分支 | （IDEA Git 无原生 changelist↔branch 自动绑定；**任务上下文（Tasks）** 可关联 changelist 与 branch） | 任务切换 | `ActiveChangeListTracker`；任务管理器 | `vcs-impl/.../impl/ActiveChangeListTracker.kt`；任务上下文集成「待核实」具体绑定类 | 中 | 无 |

### 组 3：Partial / Selective / 按行（line-level）提交

| # | 功能名 | 用户可见行为 | 触发入口 | 底层机制 | 源码锚点 | 复刻难度 | VS Code 原生 |
|---|---|---|---|---|---|---|---|
| 22 | 选择性勾选文件提交 | 勾选/取消文件，未勾选保留 | 复选框 | changelist 内子集提交 | `vcs-impl/.../changes/ui/CommitDialogChangesBrowser.java`；`GitCheckinEnvironment.commit(changes)` 接受子集 | 低 | 是（SCM 文件勾选） |
| 23 | 按代码块（chunk）提交 | Diff 中勾选 chunk 提交，其余保留 | Diff 区勾选 | `PartialLocalLineStatusTracker` + `PartialCommitHelper` | `vcs-impl/.../impl/PartialChangesUtil.kt`（`getPartialTracker`/`processPartialChanges`）；`vcs-api/.../vcs/ex/PartialCommitHelper`；`GitCheckinEnvironment.addPartialChangesToIndex` | **高** | 部分（git staging + chunk staging，VS Code 1.70+ 支持 staging selected lines） |
| 24 | 按行（line）提交 | 右键行 → Split Chunks & Include Selected Lines | gutter 复选 / 右键 | `LineStatusTracker` 行级 exclusion | `PartialChangesUtil.convertExclusionState`；官方文档「Split Chunks and Include Selected Lines into Commit」 | **高** | 部分（Staged/Unstaged 选择行） |
| 25 | Move Lines to Another Changelist | 编辑时把行级改动划入不同 changelist | gutter marker → 选 changelist | 行级 `ChangeListChange` + `PartialLocalLineStatusTracker` | `PartialChangesUtil`、`ChangeListChange`；官方文档「Put changes into different changelists」 | **高** | **无** |
| 26 | Git Staging Area 模式 | 设置启用 → changelist 切换为 index 暂存模型 | 设置 `Enable staging area` | `GitStagingAreaStateManager` + index | `checkin/GitStagingAreaStateManager.kt`、`GitIndexInfoStagingAreaStateManager.kt`、`GitResetAddStagingAreaStateManager.kt`；`commit/GitStagingAreaCommitMode.kt` | 中 | 是（VS Code 原生 index 模型） |

### 组 4：Shelf 与 Stash

| # | 功能名 | 用户可见行为 | 触发入口 | 底层机制 | 源码锚点 | 复刻难度 | VS Code 原生 |
|---|---|---|---|---|---|---|---|
| 27 | Shelve changes（IDEA patch） | 暂存选定改动为 IDEA patch；可选择部分文件 | 右键 Shelve Changes / Shelve Silently（`Ctrl+Shift+H`） | `ShelveChangesManager`（patch 文件存储） | `vcs-impl/.../changes/shelf/ShelveChangesManager.java`、`ShelveChangesAction.kt`、`ShelveChangesCommitExecutor.java` | 中 | **无**（需 git stash 替代） |
| 28 | Unshelve silently / with conflict | 还原 shelf；静默或弹冲突解决 | `Ctrl+Shift+U` / Unshelve Silently（`Ctrl+Alt+U`）/ 拖拽 | `ShelvedChangesViewManager` + 3-way merge（冲突） | `shelf/UnshelveWithDialogAction.java`、`ShelvedChangesViewManager.java`、`RestoreShelvedChange.java` | 中 | 无 |
| 29 | Stash changes（git native） | `git stash push`（可选 `--keep-index`、message、指定文件 pathspec） | 右键 Git \| Stash Changes | `git stash push [--keep-index] [--message] [-- pathspec]` | `stash/GitStashUtils.kt`（`createStashHandler`/`runStashInBackground`）；`ui/GitStashDialog.kt`、`GitStashContentProvider.kt` | 中 | 是（命令式，无原生 UI） |
| 30 | Apply / Pop / Drop / Clear stash | Apply 保留 / Pop 移除 / Drop 单个 / Clear 全部；可选 Reinstate Index（`--index`）；Unstash as new branch | Stash tab 按钮 / 右键 | `git stash apply\|pop\|drop\|branch` | `stash/GitStashUtils.kt`（`GitStashOperations.dropStashWithConfirmation`/`clearStashesWithConfirmation`/`unstash`/`createUnstashHandler`） | 中 | 部分（命令式） |
| 31 | Combine Stash & Shelf tab | 合并两个标签页 | 设置 `Combine stashes and shelves in one tab` | UI 合并 | `stash/ui/GitStashContentProvider.kt`、`shelf/ShelvedChangesViewManager.java` | 低 | 无 |
| 32 | Import external patches 为 shelf | 导入 patch 作为 shelf 再 unshelve | Shelf 右键 Import Patches | patch 解析 + shelf | `shelf/ImportIntoShelfAction.java` | 低 | 无 |
| 33 | Shelve base revision（DCVS） | 自动保存 base revision 以支持 3-way merge | 设置 `Shelve base revisions` | base revision 存储 | `shelf/ShelveChangesManager`（配置项） | 低 | 无 |
| 34 | Save to Shelf（不重置本地） | 复制改动到 shelf 但保留本地 | `Ctrl+Shift+A` Save to Shelf | patch 复制 | `shelf/ShelveChangesAction.kt`（相关 action） | 低 | 无 |

### 组 5：Diff（对比）

| # | 功能名 | 用户可见行为 | 触发入口 | 底层机制 | 源码锚点 | 复刻难度 | VS Code 原生 |
|---|---|---|---|---|---|---|---|
| 35 | 与 HEAD/分支/本地对比 | Diff Viewer 对比本地 vs HEAD / 任意分支 / 本地版本 | Diff 按钮（`Ctrl+D`）/ Compare HEAD, Staged and Local | `DiffProvider`/`GitDiffProvider` | `git4idea/diff/`；`ui/GitShowDiffWithBranchPanel.kt`；`branch/GitCompareBranchesUi.kt` | 中 | 是（editor diff） |
| 36 | Compare HEAD/Staged/Local 三方 | 三窗 Diff（repo / 中央可编辑 staging / local） | 右键 Compare HEAD, Staged and Local Versions | staging area interactive staging | 官方文档「Stage changes interactively」；`checkin/GitIndexUtil`（`listStaged`/`listTree`） | 中 | 部分 |
| 37 | Annotate（blame） | 编辑器/gutter 显示逐行作者/提交 | Annotate | `GitAnnotationProvider` | `annotate/GitAnnotationProvider.kt`；`actions/GitToggleAnnotationOptionsActionProvider.java` | 中 | 是（GitLens 等；VS Code 1.90+ 实验内置） |
| 38 | Show History for selection | 选中代码/文件的历史 | 右键 Show History / Git History | `GitFileHistory`/`GitHistoryUtils` | `changes/GitFileHistory.kt`、`MutableLinearGitFileHistory.kt`；`history/GitHistoryUtils.kt` | 中 | 是（文件历史） |

### 组 6：Log 提交图

| # | 功能名 | 用户可见行为 | 触发入口 | 底层机制 | 源码锚点 | 复刻难度 | VS Code 原生 |
|---|---|---|---|---|---|---|---|
| 39 | 提交图（graph） | 分支拓扑图、彩色节点 | Git 工具窗口 Log tab（`Alt+9`） | `platform/vcs-log`（VcsLog data + UI） | `platform/vcs-log/`（`VcsLogUi`、graph 渲染）；git4idea `log/` | **高** | 无原生（需 GitGraph 等插件） |
| 40 | Search / filter（author/path/date/branch/regex） | 按 author、path、date、branch、正则过滤 | Log toolbar 过滤 | VcsLog filter 体系 | `platform/vcs-log/`（filter providers）；官方文档 [Log Tab](https://www.jetbrains.com/help/idea/log-tab.html) | 中 | 部分（无原生图形 log 过滤） |
| 41 | Cherry-pick from log | 右键提交 → Cherry-Pick 到当前分支 | 右键 Cherry-Pick | `git cherry-pick` | `cherrypick/GitCherryPickAction.kt`；`branch/CherryPickedCommitsHighlighter.kt` | 中 | 无原生 |
| 42 | Revert commit from log | 右键提交 → Revert Commit（生成反向提交） | 右键 Revert Commit | `git revert` | `revert/`（commit-level）；`actions/GitRevertResolvedAction.kt` | 中 | 无原生 |
| 43 | Undo Commit / Push All up to Here / Drop（rebase） | 撤销最近提交 / 推送到某提交 / rebase 删除 | 右键 / Log action | soft reset / `git push <ref>` / interactive rebase | `actions/GitPushUpToCommitAction.kt`；`rebase/`（interactive） | 中 | 无原生 |
| 44 | Reword / Squash / Fixup（from log，interactive rebase） | 在 log 内改写提交 | 右键 + interactive rebase | interactive rebase | `rebase/GitRewordAction.kt`、`GitAutoSquashCommitAction.kt`、`GitCommitSquashBySubjectAction.kt`、`interactive/GitInteractiveRebaseUsingLog.kt` | 高 | 无原生 |

### 组 7：Branches

| # | 功能名 | 用户可见行为 | 触发入口 | 底层机制 | 源码锚点 | 复刻难度 | VS Code 原生 |
|---|---|---|---|---|---|---|---|
| 45 | Create / Checkout branch | 新建并检出 / 检出现有 / checkout-as-new | VCS widget / Branches pane | `git checkout -b/-` | `branch/GitCreateBranchOperation.kt`、`GitCheckoutOperation.java`、`GitCheckoutNewBranchOperation.java`；`actions/branch/GitCheckoutAsNewBranch.kt` | 低 | 是（命令面板） |
| 46 | Delete / Rename branch | 删除本地/远程分支/标签、重命名 | 右键 Delete/Rename | `git branch -d/-D`/`-m`；`git push origin --delete` | `branch/GitDeleteBranchOperation.java`、`GitDeleteRemoteBranchOperation.java`、`GitRenameBranchOperation.java`、`GitDeleteTagOperation.java` | 低 | 部分 |
| 47 | Compare branches | 对比两分支文件差异 | 右键 Compare | `GitCompareBranchesUi` + diff fs | `branch/GitCompareBranchesUi.kt`、`GitCompareBranchesFilesManager.java`、`GitCompareBranchesVirtualFileSystem.kt` | 中 | 无原生 |
| 48 | Merge / Rebase / Pull / Push / Fetch（分支级） | 在分支上执行 merge/rebase/update/push/fetch | 分支右键菜单 | 各 operation worker | `branch/GitMergeOperation.java`、`GitBranchWorker.java`；`rebase/GitRebaser.java`；`actions/branch/GitPullBranchAction.kt`、`GitPushBranchAction.kt`、`GitRebaseBranchAction.kt`、`GitUpdateSelectedBranchAction.kt`；`actions/GitFetch.java` | 中 | 是（命令式） |
| 49 | Branches Dashboard / Popup | 分支树状仪表盘 + popup 选择器 | Git 工具窗口 Branches pane | `BranchesDashboardTree*` + popup | `ui/branch/dashboard/BranchesDashboardTreeController.kt`、`BranchesTree.kt`；`ui/branch/GitBranchWidget.kt`、`popup/GitBranchesTreePopupOnBackend.kt` | 中 | 部分（VS Code status bar） |
| 50 | Cleanup branches / Find merged | 清理已合并分支、查找合并的本地分支 | Cleanup action | `git branch --merged` | `ui/branch/cleanup/CleanupBranchesAction.kt`、`branch/FindMergedLocalBranchesAction.kt` | 低 | 无 |

### 组 8：右键 / 内联操作

| # | 功能名 | 用户可见行为 | 触发入口 | 底层机制 | 源码锚点 | 复刻难度 | VS Code 原生 |
|---|---|---|---|---|---|---|---|
| 51 | Revert / Rollback | 回滚未提交改动（`RollbackEnvironment`） | 右键 Rollback / `RollbackChangesDialog` | `git checkout --` / reset | `rollback/GitRollbackEnvironment.java`；`vcs-impl/.../changes/ui/RollbackChangesDialog.kt`、`RollbackWorker.java` | 中 | 是（Discard Changes） |
| 52 | Reset HEAD（mixed/soft/hard/keep） | Git Reset 对话框选择模式 | 右键 / `GitResetHead` action | `git reset --soft/--mixed/--hard/--keep` | `actions/GitResetHead.java`；`ui/GitResetDialog.java` | 低 | 无原生（命令式） |
| 53 | Ignore | 加入 .gitignore | 右键 Add to .gitignore | `ignore/` + `.gitignore` 写入 | `ignore/`（GitIgnore 集成） | 低 | 是 |
| 54 | Compare / Show Diff | 对比改动 | 右键 Show Diff | `diff/` | `git4idea/diff/`；`ChangesBrowserBase`（diff producer） | 中 | 是 |
| 55 | Jump to Source | 跳到源码 | 右键 Jump to Source / `F4` | 编辑器导航 | `vcs-impl/.../changes/ui/EditSourceForDialogAction.java` | 低 | 是 |
| 56 | Copy revision | 复制 commit hash / 修订号 | 右键 Copy Revision / Copy Hash | 剪贴板 | `branch/GitRefDialog` 等（参考 Log 右键 Copy Hash） | 低 | 部分 |

---

## C. IDEA「多 changelist」模型 vs VS Code SCM「group」模型 差异要点

| 维度 | IDEA 多 changelist | VS Code SCM group |
|---|---|---|
| 核心抽象 | `LocalChangeList`（命名、有 id、有 comment、可设 active）+ `Change` 可属于多个列表（同一文件不同 chunk 跨列表，`ChangeListChange` + `PartialLocalLineStatusTracker`） | `SourceControlResourceGroup`（按 type/自定义 label 分组，无「active」概念，无跨组同文件 chunk） |
| 数据来源 | 平台 `ChangeListManager` 统一管理（含本地 changelist 持久化、`ChangeListListener` 事件） | 扩展点 `scm.ResourceGroups`（插件自行维护） |
| Active 概念 | 有「active changelist」：新改动默认落入；`getDefaultChangeList`/`setDefaultChangeList` | 无；新改动归属由插件决定（通常单组 Staged/Changes） |
| 行级跨列表 | 支持（`PartialChangesUtil`/`PartialLocalLineStatusTracker`：同一文件不同行属于不同 changelist） | 不支持原生；git staging 可部分行 stage，但无「命名列表」归属 |
| 持久化 | `ChangeListManagerSerialization` 持久化 changelist 定义 | 插件自定义状态 |
| 与 git index 关系 | 默认「changelist 即待提交集」（非 staging 模型）；可选切换为 Staging Area 模式（`GitStagingAreaCommitMode`） | 默认即 staging 模型（Changes/ Staged） |
| 提交范围 | 提交所选 changelist（或其中勾选子集） | 提交整个 Staged group |
| 自动绑定分支 | **无原生 changelist↔branch 自动绑定**；需 Tasks 上下文（`ActiveChangeListTracker`） | 无 |

> **复刻映射建议**：VS Code SCM 的 `ResourceGroup` 难以 1:1 表达「active + 跨文件行级归属」，建议在插件层自建「changelist registry」（仿 `ChangeListManager` + `ChangeListChange`），将 SCM group 作为渲染层，并通过 `LineStatusTracker`-like 行级 tracker 支撑 partial commit。这是 IDEA 模型对 VS Code 最大的差异与复刻难点。

---

## D. IDEA Checkin 流水线（CheckinHandler 生命周期）hook 点清单

> 来源：`platform/vcs-api/src/com/intellij/openapi/vcs/checkin/CheckinHandler.java`（完整源码已读）。
> 注册：通过 `BaseCheckinHandlerFactory`/`VcsCheckinHandlerFactory`（EP `com.intellij.checkinHandlerFactory` 全局 + `com.intellij.vcs.checkinHandlerFactory` VCS 专属），由 `CheckinHandlersManagerImpl`（`platform/vcs-impl/.../impl/CheckinHandlersManagerImpl.kt`）聚合。
> 现代 IDEA 推荐实现 `CommitCheck`（suspend 协程，返回 `CommitProblem`）替代旧 `beforeCheckin`。git4idea 的 `GitCheckinHandler` 抽象类同时实现 `CheckinHandler` + `CommitCheck`。

| Hook 点 | 方法签名 | 触发时机 | 返回/语义 | AI 接入价值 |
|---|---|---|---|---|
| Before-Commit 配置面板（Before Commit 组） | `RefreshableOnComponent getBeforeCheckinConfigurationPanel()` | 构建 commit 窗口选项面板 | 注入复选框（如 Reformat/Optimize imports/Check TODO） | 高：注入「AI review before commit」开关 |
| Before-Commit 设置项（Settings 页） | `UnnamedConfigurable getBeforeCheckinSettings()` | `Settings \| VCS \| Commit` 配置页 | 持久化设置 | 中：AI 规则配置 |
| After-Commit 配置面板 | `RefreshableOnComponent getAfterCheckinConfigurationPanel(Disposable)` | 构建 After Commit 选项面板 | 注入部署等选项 | 低 |
| **Before check-in（核心闸门）** | `ReturnResult beforeCheckin(CommitExecutor, PairConsumer)` / `beforeCheckin()` | 提交按钮按下后、真正 commit 前 | `COMMIT`/`CANCEL`/`CLOSE_WINDOW` 可阻断提交 | **高**：AI 代码审查/质量闸门，可阻断不良提交 |
| **CommitCheck（现代协程闸门）** | `suspend CommitProblem? runCheck(CommitInfo)` / `runGitCheck(commitInfo, changes)` | beforeCheckin 的协程演进版；`commitInfo.isVcsCommit` 时执行 | 返回 `CommitProblem`（含 `showModalSolution`） | **高**：AI 异步审查最佳挂载点（仿 `GitCheckinHandler`） |
| CommitCheck 执行顺序 | `CommitCheck.ExecutionOrder getExecutionOrder()` | 排序多个 CommitCheck | `EARLY`/`DEFAULT`/`LATE` | 中：控制 AI 检查与其他检查顺序 |
| CommitCheck 启用开关 | `boolean isEnabled()` | 决定是否运行 | 布尔 | 中 |
| **Successful 回调** | `void checkinSuccessful()`（`@RequiresEdt`） | 提交成功后 | 通知/后续动作 | 高：AI 提交摘要、自动生成 PR 描述 |
| **Failed 回调** | `void checkinFailed(List<VcsException>)` | 提交失败后 | 异常列表 | 中：AI 诊断失败原因 |
| **变更勾选变更通知** | `void includedChangesChanged()` | 用户勾选/取消变更时 | 实时感知提交范围 | **高**：AI 实时根据勾选范围动态生成 commit message |
| Executor 过滤 | `boolean acceptExecutor(CommitExecutor)` | 决定本 handler 是否对某 executor 生效 | 默认对非 `LocalCommitExecutor` 生效（即 shelf/create patch 不跑该检查） | 中：区分 commit vs shelf vs push |
| CommitProblem 模态解决 | `CommitProblem.showModalSolution(project, commitInfo)` | 检查发现问题时弹模态方案 | `ReturnResult` | 中：AI 给出修复建议弹窗 |

> **CommitContext 关键字段**（贯穿整个流水线，承载 commit 选项）：`commitToAmend`、`isSkipHooks`、`commitAuthor`、`commitAuthorDate`、`isSignOffCommit`、`isPushAfterCommit`、`isCommitRenamesSeparately`、`commitWithoutChangesRoots`。源码：`GitCheckinEnvironment.updateState()` / `doCommit()`。
>
> **AI 接入建议**：实现一个 `CommitCheck`（EARLY 顺序）挂载 AI 审查 + 实现 `includedChangesChanged()` 动态生成 commit message + 实现 `checkinSuccessful()` 触发 AI 后处理，可完整复用 IDEA 提交流水线的「设计-实现-验证」闭环，无需重写 commit 引擎。

---

## E. 关键事实来源（循证索引）

### 源码（GitHub master）
- 提交 handler 生命周期：[`platform/vcs-api/.../checkin/CheckinHandler.java`](https://github.com/JetBrains/intellij-community/blob/master/platform/vcs-api/src/com/intellij/openapi/vcs/checkin/CheckinHandler.java)
- git4idea 提交环境与 Amend：[`plugins/git4idea/.../checkin/GitCheckinEnvironment.kt`](https://github.com/JetBrains/intellij-community/blob/master/plugins/git4idea/src/git4idea/checkin/GitCheckinEnvironment.kt)、[`GitCheckinHandlerFactory.kt`](https://github.com/JetBrains/intellij-community/blob/master/plugins/git4idea/src/git4idea/checkin/GitCheckinHandlerFactory.kt)
- ChangeListManager 抽象：[`platform/vcs-api/.../changes/ChangeListManager.java`](https://github.com/JetBrains/intellij-community/blob/master/platform/vcs-api/src/com/intellij/openapi/vcs/changes/ChangeListManager.java)
- Partial changes 工具：[`platform/vcs-impl/.../impl/PartialChangesUtil.kt`](https://github.com/JetBrains/intellij-community/blob/master/platform/vcs-impl/src/com/intellij/openapi/vcs/impl/PartialChangesUtil.kt)
- Shelf 管理：[`platform/vcs-impl/.../changes/shelf/ShelveChangesManager.java`](https://github.com/JetBrains/intellij-community/blob/master/platform/vcs-impl/src/com/intellij/openapi/vcs/changes/shelf/ShelveChangesManager.java)
- Stash 操作：[`plugins/git4idea/.../stash/GitStashUtils.kt`](https://github.com/JetBrains/intellij-community/blob/master/plugins/git4idea/src/git4idea/stash/GitStashUtils.kt)
- Checkin handler 聚合：[`platform/vcs-impl/.../impl/CheckinHandlersManagerImpl.kt`](https://github.com/JetBrains/intellij-community/blob/master/platform/vcs-impl/src/com/intellij/openapi/vcs/impl/CheckinHandlersManagerImpl.kt)
- Commit message 提供器 EP：[`platform/vcs-api/.../changes/ui/CommitMessageProvider.java`](https://github.com/JetBrains/intellij-community/blob/master/platform/vcs-api/src/com/intellij/openapi/vcs/changes/ui/CommitMessageProvider.java)
- changelist 命令体系：`platform/vcs-impl/.../changes/local/{AddList,EditName,EditComment,MoveChanges,RemoveList,SetDefault,SetReadOnly}.java`

### 官方文档（jetbrains.com/help/idea 2026.1）
- [Commit and push changes to Git repository](https://www.jetbrains.com/help/idea/commit-and-push-changes.html)（commit 窗口、amend、author、commit checks、partial commit、staging area、push）
- [Shelve or stash changes](https://www.jetbrains.com/help/idea/shelving-and-unshelving-changes.html)（shelve/unshelve silently/with conflict、stash apply/pop/drop/keep index、combine tabs）
- [Group changes into changelists](https://www.jetbrains.com/help/idea/managing-changelists.html)（active/create/move/delete/rename changelist）
- [Log Tab](https://www.jetbrains.com/help/idea/log-tab.html)（graph/filter/cherry-pick/revert）
- [Manage Git branches](https://www.jetbrains.com/help/idea/manage-branches.html)（create/checkout/delete/rename/compare/merge/rebase）
- [Edit Git project history](https://www.jetbrains.com/help/idea/edit-project-history.html)（amend 历史、reword/squash/fixup）
- [Investigate changes in Git repository](https://www.jetbrains.com/help/idea/investigate-changes.html)（history/annotate）

---

## F. 待核实 / 不确定项
1. **LocalChangeList 接口/实现类的精确文件路径**：zread 多次返回「文件不存在」（API 类可能位于非直觉路径或为生成/移动类），但其方法语义已通过 `ChangeListManager.java`（大量引用）+ `PartialChangesUtil.kt`（`LocalChangeList` import）+ `ChangeListWorker.java`（实现侧）交叉证实存在。**建议**复刻阶段直接以 `ChangeListManager` API 为契约蓝本。
2. **Conventional Commits 内置校验**：WebSearch 与文档检索均未发现 IDEA 内置 CC 强校验类；结论为「IDEA 无原生 CC 校验，依赖 commit message 规则/第三方插件」，需在复刻时自行实现 CC linter。
3. **Changelist 自动绑定分支的具体类**：`ActiveChangeListTracker.kt` 存在，但「changelist↔branch」自动绑定疑似走 Tasks 上下文模块（非 git4idea），未定位到确切绑定类。
4. **分支级 Pull/Push/Fetch 的精确 action 类**：`actions/branch/GitPullBranchAction.kt` 等结构已确认存在，但内部委托链（→ `GitBranchWorker`/`GitFetch`）未逐行核实。
