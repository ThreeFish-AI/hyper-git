# Changelog

本项目的所有重要变更均记录于此文件。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- **Log 视图升级为 IDEA 风格提交图（Graph DAG）**：`hyperGit.log` 由原生 TreeView（`log-tree.ts`）迁移为 Webview，基于 commit 父子关系**自计算 DAG lane 布局**，完整复刻 IntelliJ IDEA Git Log 的彩色泳道 / 节点 / 分叉·合并连线 / HEAD·分支·标签标签——不再依赖 `git log --graph` 的粗糙 ASCII（lane 由 git 分配、不可控、随列号抖动着色）。新增纯逻辑引擎 `engine/log/graph-layout.ts`（单遍增量 lane 状态机，nil-slot 复用保证分支「直顺」；`graph-color.ts` 沿首父链继承 + 相邻 lane 异色；覆盖 octopus 合并 / 多 root / 收敛 / 截断 dangling 边）、`log-line.ts`（NUL/RS 解析）与 `log-query.ts`（`--topo-order` 保拓扑序；author/grep/path 服务端 + mergeMode/date/regex 客户端复用 `applyClientFilters`），单测 29 例全覆盖。Webview 端虚拟化「每行内联 SVG + 文本列」渲染、主题调色板（`--vscode-` 令牌 + hex 回退）、All/Current 范围切换、滚动增量加载、↑↓ 键导航、选中提交内联展示变更文件（点击打开 diff）、右键 per-commit 操作菜单（复用既有 9 个命令）。移除独立的 `showGraph` 面板与 `graph-parser`（单一事实源去重）；新增 `LogFilterControl` 接口使 4 个命令注册器零行为改动完成迁移。
- **Branches 视图多选 + 批量操作**：`hyperGit.branches` 由 `registerTreeDataProvider` 改用 `createTreeView({ canSelectMany: true })`，支持 Ctrl/Cmd/Shift 框选多个分支/标签。批量命令作用于整个选区：**删除分支**（一次 `git branch --merged` 分类已合并/未合并，单条确认弹窗诚实分栏呈现强制删除风险，逐个删除并汇总成功/失败）、**删除标签**、**复制引用**（按行连接）、**收藏切换**。仅单目标语义的操作（检出/合并/变基/重命名/比较）经 `!listMultiSelection` 在多选时从右键菜单隐藏，且因仅读「右键点击项」而始终安全。新增纯逻辑 `engine/ref/selection.collectBranchRefs`（选区归一化 + 「点击在选区之外」手势优先）与 `engine/ref/cleanup` 的 `partitionByMerged`/`formatBranchDeleteConfirm`/`truncateNames`，单测全覆盖。

### Changed

- **品牌图标统一**：将活动栏图标（`media/hyper-git-icon.svg`）、Marketplace 市场徽标（`media/icon.png`）与 README 头图统一为辨识度更高的「Git Pull Request」造型（字形改编自 Tabler Icons，MIT）；市场徽标基于新字形重新栅格化为 256×256 RGBA 蓝→紫渐变图，设计源沉淀至 `media-src/icon.svg`；README 头部重构为居中布局（徽标 + 标题 + 一句话定位 + License 徽章）。

## [0.0.1-rc.4] - 2026-06-29 — 第四个预发布候选

> 修复用户截图反馈的两处工具窗口缺陷：活动栏图标缺失「未提交文件数」角标、Branches「Push」对无上游分支失败。
>
> 版本号遵循 VS Code Marketplace 约定（`major.minor.patch` = `0.0.4`），预发布语义由 `--pre-release` 标记 + git tag `v0.0.1-rc.4` 体现。

### Fixed

- **活动栏未提交角标（#17）**：`hyperGit.changes` 原经 `registerTreeDataProvider` 注册，仅得 `Disposable` 无法承载 `.badge`；改用 `createTreeView` 获取 `TreeView` 句柄并新增 `updateChangesBadge()`，计数复用 `GitRepositoryService.getChanges()`（index+工作区+未跟踪去重），接入既有 `refreshAll` 防抖链路与首帧保险，计数为 0 时清空。活动栏容器图标角标为容器内各视图 `badge.value` 之和，故 Hyper Git 图标自此实时显示未提交文件数，对齐原生 SCM。
- **Branches Push 对无上游分支失败（#17）**：`hyperGit.push` 原以零参数调 `repo.push()`，当前分支无上游时 `git push`（`push.default=simple`）必然失败，vscode.git 包装为 `GitError`、其 `.message` 恰为通用串「Failed to execute git」而真实 stderr 被吞没。改为以 `HEAD.upstream` 是否存在分流：有上游沿用 `repo.push()`；无上游则选定 remote（单 remote 直用、多 remote 弹选）并以 `repo.push(remote, branch, true)` 建立 `-u` 追踪。同时增强 `errMsg` 优先暴露 `GitError.stderr`，使「无上游」「non-fast-forward」等失败可读（push/pull/fetch 等同享）。

## [0.0.1-rc.3] - 2026-06-29 — 第三个预发布候选

> 包含 rc.2 后的全部 Parity Recovery（Batch 5-12），完成 IDEA Git 工具窗口全量对齐；并修复发布流水线，使 GitHub Release 自此自动附带「可本地安装的 `.vsix`」资产。
>
> 版本号遵循 VS Code Marketplace 约定（`major.minor.patch` = `0.0.3`），预发布语义由 `--pre-release` 标记 + git tag `v0.0.1-rc.3` 体现。

### CI / 发布

- **GitHub Release 自动附带 `.vsix`**：CI 新增独立 `github-release` job（`softprops/action-gh-release`），对每个 `v*` tag 复用 `package` job 产出的 vsix artifact，自动创建 Release（`*rc*` tag 自动标记 prerelease）并上传 `.vsix` 资产，用户可直接「`Extensions: Install from VSIX`」本地安装。该 job 与市场 `publish` 解耦（`needs: package`、不挂 `production` 环境），即便市场发布待审批/失败亦不影响 Release 资产产出；`fail_on_unmatched_files` 杜绝「空资产 Release」。

### Added — Parity Recovery（Batch 5-12，IDEA 全量对齐）

> 基于「IDEA Git 功能复刻全量对齐」评审（用户截图反馈 Branches 空白/工具栏缺失），经 3 路代码审计确认「功能多数已实现但被视图 bug + 工具栏未浮现掩盖」，本批次先解除可见痛感再全量补齐。共新增 **13 个 engine 纯逻辑模块 + 21 个命令**，单测 64 → 166。

- **Branches 视图渲染修复（Batch5）**：`engine/ref/for-each-ref`（NUL 分隔 + upstream/HEAD/ahead-behind track）+ async getChildren + `repo.state.refs` 为空时 `git for-each-ref` CLI 兜底 + 首帧刷新（修复初始 `_onDidChange.fire` 早于订阅挂载而丢失的根因）。
- **工具栏 Action 组补齐 + 命令 bug（Batch5）**：Changes 加 fetch/pull/push/commit；Branches 加 fetch；Log 加 cherry-pick/revert/reset；cherry-pick/revert 成功后刷新；resetHead 重写（修 `HEAD~0` 致 mixed/keep 失效）；branchDelete 加 `--merged` 检查；merge/rebase 加确认。
- **冲突兜底引导（Batch5）**：`engine/git-state/conflict-detector` + `adapter/conflict-ui`；merge/rebase/pull/cherry-pick/revert/stash-pop/unshelve 失败检测冲突弹「解决/中止」。
- **Branches 对齐 IDEA（Batch6）**：Favorites/Local/Remote/Tags 四段分组 + ahead/behind/upstream 展示 + `engine/ref/favorites`/`cleanup`（提取复用）+ toggleFavorite/checkoutAsNew/compareWithCurrent/tagCreate/tagDelete/tagCheckout。
- **交互式 Rebase webview 1:1 复刻（Batch7）**：补 reword/edit + 拖拽重排序；reword 经 `process.execPath` 跑 Node editor helper + state 文件非交互写入新 message（已功能性验证）；`engine/rebase/todo`。
- **Log 提交详情面板 + 高级过滤（Batch8）**：commit 展开显示变更文件（`engine/log/commit-files`）+ 单文件 diff（commit^ vs commit）+ `engine/log/log-filter`（合并模式/日期/正则）+ per-commit 操作（resetToHere/createBranchFromCommit/createTagFromCommit/showContainingBranches）。
- **真实 SVG 提交拓扑图（Batch9）**：解析 `git log --graph` 字符粒度渲染（`*` 圆点可点击 / `|` 竖线 / `/ \` 斜线，多色 lane）+ 实时刷新 + 节点点击 QuickPick；`engine/log/graph-parser`。
- **Push/Update/Merge 对话框（Batch10）**：force/force-with-lease/push tags、pull --rebase/--no-rebase、merge ff-only/no-ff/squash + message；fetch --prune；`engine/commit/trailer`（Co-authored-by）。
- **自绘 3-way Merge Editor（Batch11）**：自实现 `engine/merge/diff3`（基于 LCS，双方同改动自动消解）+ WebviewPanel 三栏（OURS/RESULT 可编辑/THEIRS）+ Accept 按钮 + 写回 `git add`；handleGitConflict「解决冲突」直接调起。
- **Phase 4/5 收尾（Batch12）**：Stash 高级（keep-index/clear/branch）、Patch create/apply、Reflog 视图、编辑器内 Blame 行内注解（`engine/blame/blame-parser` + `adapter/editor/blame-annotation`）。

### 架构与质量
- 新增 engine 模块（零 vscode 依赖、可单测）：`ref/{for-each-ref,favorites,cleanup}`、`rebase/todo`、`log/{log-filter,commit-files,graph-parser}`、`merge/diff3`、`commit/trailer`、`git-state/conflict-detector`、`blame/blame-parser`。
- 命令 56 → 77；单测 64 → 166（+21 文件）；集成 3/3；lint/类型/构建全程 GREEN。
- 关键算法（reword helper / graph 解析 / diff3 / blame 解析）均做真实 git 数据功能性验证。
- git 底座：稳定 API 能做的用 `Repository.*`；缺口用 `GitRepositoryService.execGit`（复用 `api.git.path` 同一二进制）。

### 待补（后续）
- Commit webview 的 Co-authored-by / author 覆盖（`--author`）/ undo-last-commit 按钮 UI 接线（engine trailer 已就绪）。
- Partial 多文件选择 UX、行级 split chunks（IDEA "Include Selected Lines"）。
- 目录/folder diff（虚拟文档）、Submodules 管理。
- M5 AI Agent（5 个接缝已预埋 Null 实现，本轮未启动）。



## [0.0.1-rc.2] - 2026-06-28 — 第二个预发布候选

包含 rc.1 后的全部 Parity Recovery（Batch 1-4 + Editor Inline Commit），大幅补齐 IDEA Git 功能复刻。

### 核心新增（自 rc.1）
- **Editor Inline Commit**（#13）：CodeLens「✓ 提交此 Hunk」→ 仅暂存该 hunk → 提交。
- **Cherry-pick / Revert / Reset / Branch rename / Compare / Ignore / Reword**（经 `api.git.path` CLI 通道）。
- **Git 提交图**（Webview `git log --graph` 着色拓扑）+ **Console**（git 命令输出面板）。
- **partial/hunk 级提交**（hunk 解析引擎 + 选择暂存 + 光标处暂存）+ undo/drop/fixup + cleanup branches + 3-way diff。
- **忠实 Shelf**（patch 存储 + unshelve 三方合并）+ **交互式 Rebase UI**（pick/squash/fixup/drop Webview）+ **Move Hunk to Changelist**（#25）。
- **Stash 多栈列表** + Discard + Pull/Push/Fetch + PNG 图标 + Dependabot。

### Added — Parity Batch 4（忠实 Shelf + 交互式 Rebase + Line→CL，0.0.6）

- **忠实 Shelf**（IDEA patch-based，#27-28）：Shelve（`git diff` → patch 存扩展存储 → `git checkout --` 移除工作区）+ Unshelve silently / with 3-way merge + Delete + Shelf TreeView。与 Stash 独立并存。
- **交互式 Rebase UI**（Webview，#44）：commit 列表 + pick/squash/fixup/drop 动作 → 非交互 rebase（`GIT_SEQUENCE_EDITOR=cp <tempfile>` + `GIT_EDITOR=:`）。
- **Move Hunk to Changelist**（#25）：编辑器内光标处 hunk → QuickPick changelist → ChangelistRegistry 持久化 hunk→CL 归属。

### Added — Editor Inline Commit（#13，0.0.5）

> IDEA editor inline commit 的 VS Code 等价（补齐最后一块主要拼图）。

- **行内提交 CodeLens**：编辑器中每个未暂存 hunk 上方渲染可点击 CodeLens「✓ 提交此 Hunk (+N -M)」→ 仅暂存该 hunk（patch 重建 + `git apply --cached`）→ 输入 message → `git commit`。
- 新增 `engine/diff/editor-mapping`（hunk → 编辑器行区域映射，纯逻辑 + 5 单测）；gutter 行标记（绿/红/蓝）由原生 git quickDiff 提供。
- 其他已暂存内容会一并提交时给出二次确认提示。

### Added — Parity Batch 3（partial commit + 高级操作，0.0.4）

- **partial / 行级提交**（IDEA PartialChangesUtil 等价）：`engine/diff/hunk-parser`（unified diff 解析，7 单测）+ hunk 选择暂存/取消暂存（QuickPick 勾选）+ 光标处 hunk 暂存——经 patch 重建 + `git apply --cached`。
- **undo commit**（soft reset，保留改动到暂存区）、**drop commit**（`git rebase --onto`，重写历史二次确认）、**fixup**（autosquash rebase，经 env 注入 `GIT_SEQUENCE_EDITOR`）。
- **cleanup branches**（`git branch --merged` 批量删除）、**copy branch ref**、**3-way diff 概览**（HEAD↔Staged↔Working）。
- `execGit` 支持 env 注入（为 autosquash 等 rebase 自动化铺路）。

### Added — Parity Batch 2（UI 丰富度，0.0.3）

- **Git 提交图（WebviewPanel）**：`git log --graph --oneline --decorate --all`（CLI）获取拓扑，语义着色渲染（graph 连线 / refs / hash）——补齐 IDEA Log 提交图的可视化拓扑。命令面板 + Log 视图标题按钮。
- **Console**：Hyper Git Console（OutputChannel）记录所有 `execGit` 命令与输出（对齐 IDEA Console 标签页）。

### Added — Parity Batch 1（CLI 功能补齐，0.0.2）

> 关键转向：引入 `GitRepositoryService.execGit`（复用 vscode.git 的同一 git 二进制 `api.git.path`），补齐稳定 API 未暴露的操作——修正此前"API 限制延后"的过度自我设限。

- Cherry-pick（Log 右键）、Revert commit（Log 右键）——经 `git cherry-pick` / `git revert`。
- Reset HEAD（soft/mixed/hard/keep，命令面板，hard 二次确认）。
- 分支重命名（Branches 右键 `git branch -m`）、比较分支（`git diff --stat a...b`）。
- Ignore（写 .gitignore）、改写最新提交（amend）。
- **Stash 多栈列表**：用 `git stash list`（CLI）修复——apply/pop/drop 按真实 `stash@{n}` 索引（此前 `log({refNames:['stash']})` 仅返回最新 stash 内部提交、语义错误，已弃用）。

## [0.0.1-rc.1] - 2026-06-27 — 首发候选（Pre-release）

首个公开预发布候选，整合 M0-M4 里程碑交付 + 两轮独立 code review 修复。
版本号遵循 VS Code Marketplace 约定（仅 `major.minor.patch` = `0.0.1`），预发布语义由 `--pre-release` 标记 + git tag `v0.0.1-rc.1` 体现。

**核心能力**：多 changelist Changes 视图、Commit 提交窗口（Conventional Commits 校验 + Amend/sign-off/skipHooks + Checkin hook 链）、Log/Branches/Blame/Show History、Stash（create/apply/pop/drop）、Discard 改动、Pull/Push/Fetch。架构路径 B（消费 vscode.git 稳定 API），5 个 AI 接缝已预埋（M5 实现）。

**已知限制**（vscode.git 稳定 API 边界）：cherry-pick / revert / reset / 分支重命名 / 行级 hunk 暂存 / 多 stash 列表枚举 / Author 覆盖暂不可用，详见 [实施状态 §3](./docs/milestones/implementation-status.md#3-api-限制汇总vscodegit-稳定-api-边界)。

### Added — M4 Stash/Shelf（0.5.0）

- **Stash 视图**：`StashTreeProvider` 经 `Repository.log({ refNames: ['stash'] })` 枚举 stash（API 不暴露 `git stash list`，以此近似）。
- **Stash 操作**：`createStash` / `applyStash` / `popStash` / `dropStash`（经 vscode.git 稳定 API），配视图标题按钮与右键菜单 + viewsWelcome。
- **Shelf（MVP）**：以 stash 近似 IDEA shelve（工程方案 §4 P2 约定）；忠实 patch Shelf 受 API 限制延后。
- **API 限制（文档化延后）**：行级 partial commit（vscode.git `add` 仅整文件，无 hunk 暂存）、忠实 patch Shelf、Staging Area 模式开关、cherry-pick/revert/reset/分支重命名——均无稳定 API 对应，未来可经 git CLI 兜底或 proposed API 评估。

### Added — M3 Log/Branches/Diff·Blame（0.4.0）

- **Log TreeView**：消费 `Repository.log()`，按 author/path 过滤（清除过滤）、复制 commit hash、显示文件历史。完整提交图（SVG 拓扑连线）作为后续增强（M3.x）。
- **Branches TreeView**：消费 `Repository.state.refs`（Local/Remote 分组），活动分支高亮；支持新建/检出/删除/合并/变基（rebase）。
- **Blame**：`Show Blame` 命令对当前文件执行 `repo.blame` 并以只读文档展示。
- **Show History**：从 Changes 文件右键跳转 Log 并按该文件路径过滤。
- **API 限制（文档化延后）**：vscode.git 稳定 API 不含 cherry-pick / revert / reset / 分支重命名，这些 IDEA 功能暂不可用（未来可 CLI 兜底）。

### Fixed — M0/M1/M2 审查修复（0.3.1）

经 3 路独立 code review（正确性 / 架构 / 完整性）交叉复核后修复：

- **GitRepositoryService**：仓库切换时 `onDidChange` 订阅累积泄漏 → 改用单 `repoSub`，切换/卸载时 dispose。
- **pickRepository**：`startsWith` 误匹配（无路径边界）→ 改用 `api.getRepository(folder.uri)` 精确匹配。
- **getChanges**：缺失 `indexChanges`（已暂存文件不可见）→ 合并 index/working/untracked 按相对路径去重（index 优先）。
- **commit 语义**：未勾选的已暂存文件先 `restore --staged`，让勾选集成为提交权威范围（对齐 IDEA「提交该集合」）。
- **push 失败**：commit 成功后 push 失败误报「提交失败」→ 返回 `ok:true` + `warning`。
- **extension.ts**：三个 `onDidChange` 订阅入 `subscriptions`（修复卸载泄漏）。
- **refresh**：`await repo.status()` 后再刷新（避免陈旧数据）。
- **conventional-linter**：Windows `\r\n` 行尾 + 中文/Unicode scope 支持。
- **commit-webview**：`onDidReceiveMessage` 绑定 `view.onDidDispose`（修复重载泄漏）；nonce 改用 `crypto.randomBytes`；选中态 `setState` 持久化。
- **changes-tree**：tooltip 显示状态全称（Modified 而非 M）；清理 `CommitFileItem` 冗余 `status/statusName` 字段。
- **测试补齐**：`ConventionalCommitCheck`、`CommitService.executeCommit`（mock Repository，覆盖 CC 阻断/无文件/amend 透传/unstage/push 警告）、`git-status-map` 全量、`amend` 真实集成。

### Added — M2 Commit 提交窗口（0.3.0）

- Commit 提交窗口（WebviewView 自绘 IDEA 风格）：活动 changelist 文件勾选 + 多行 Commit Message 编辑器 + Amend / Signed-off-by / 跳过 Git hooks 选项 + Commit / Commit and Push 按钮。
- Conventional Commits 实时校验：`engine/commit/conventional-linter` 纯函数 + webview 指示器（ok/warning/error）+ 内置 `ConventionalCommitCheck` Checkin hook（pipeline 内阻断不合规提交）。
- `CommitPipeline` 责任链接入提交流程（对齐 IDEA `CheckinHandler`：校验 → stage → hook 链 → commit → 可选 push）。
- AI 接缝 5 接口 + Null 实现注入 CommitService（`ILlmProvider` / `ICommitMessageProvider` / `IPreCommitInspector` / `IChangelistGrouper` / `IConflictResolver`），M5 替换为真实实现。
- 最近提交消息复用（`workspaceState` 持久化，webview 一键填入）。
- 真实 git 提交闭环集成测试（fixture 仓库 + `vscode.git` add/commit + git log 校验）。

### Added — M1 Git Adapter + 多 changelist Changes（0.2.0）

- Git Adapter：`GitRepositoryService` 封装内置 vscode.git 稳定 `Repository` API（读取 workingTreeChanges/untrackedChanges、状态变更事件、diff/toGitUri 委托）。
- 多 changelist：`ChangelistRegistry`（active 列表、新建/重命名/删除/移动 + `workspaceState` 持久化，重启恢复）+ 引擎纯分组逻辑 `groupByChangelist`。
- Changes TreeView：changelist 一级节点 + 文件叶子，状态色复用 `gitDecoration.*` 主题色（ThemeIcon + ThemeColor），文件单击打开原生 `vscode.diff`。
- 命令：`refresh` / `newChangelist` / `setActiveChangelist` / `renameChangelist` / `deleteChangelist` / `moveChangelist` / `openDiff`，配视图标题与右键菜单（`viewItem` 上下文键）。
- 测试：新增 `changelist-grouper`（5）+ `git-status-map`（9）单元测试；集成测试覆盖全部 M1 命令注册。
- 工程修复：eslint flat config 忽略 `.vscode-test/**`（规避本地 test-electron 下载的 VS Code 导致 lint OOM）。

### Added — M0 脚手架 + CI

- 初始化 pnpm + esbuild + TypeScript（strict）工程骨架，对齐官方 `esbuild-sample`。
- 正交分层目录：`engine/`（纯逻辑，零 vscode 依赖）、`adapter/`、`agent/`（AI 接缝预留）、`ui/`、`shared/`、`infra/`。
- 质量基础设施：ESLint 9 flat config + typescript-eslint + @stylistic、Prettier、Vitest（engine 单测）、@vscode/test-electron + Mocha（集成测试）。
- 工程约束：`.npmrc`（`node-linker=hoisted` 规避 vsce/pnpm hoisting）、`.vscodeignore`、`engines.vscode ^1.85.0` 与 `@types/vscode 1.85.0` 严格对齐。
- 扩展贡献点：活动栏视图容器 `hyper-git` + `hyperGit.changes` 树视图（M0 占位，M1 接入真实 changelist）+ `hyperGit.showVersion` 命令 + 配置项（commit 模板 / Conventional Commits 开关 / AI 开关预留）。
- 引擎层纯逻辑：`engine/scm-mapping`（FileStatus → gitDecoration.* 主题色映射）、`engine/commit/pipeline`（Checkin hook 责任链，对齐 IDEA `CheckinHandler.ReturnResult`）。
- AI 接缝接口 + Null 实现：`agent/llm-provider.ts`（`ILlmProvider`）、`agent/pre-commit.ts`（`IPreCommitInspector`）。
- Webview ↔ Host 消息契约单一事实源：`shared/protocol.ts`。
- CI 流水线 `.github/workflows/ci.yml`：lint → build → test 矩阵（ubuntu/mac/win + Linux xvfb）→ package vsix → artifact；`tag v*` → 双市场发布（Marketplace + OpenVSX）。
