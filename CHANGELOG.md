# Changelog

本项目的所有重要变更均记录于此文件。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

> 面向用户的发布说明（含完整特性叙述与安装指引）见 [`docs/releases/`](./docs/releases/README.md)。

## [0.0.7] - 未发布

### Fixed
- 修复 `vsce package` 打包因 ESLint `no-useless-assignment` 阻断：`engine/ci/remote-parser.ts` 中 `host`/`path` 的空串初值为 dead store（`hasScheme` 真假两分支均无条件重赋、解析失败处先 `return null`），改为带类型标注的纯声明消除，由 TS 确定赋值分析接管，运行时行为不变。

## [0.0.6] - 2026-06-30 — 首个 MVP 正式版

首个对外正式版本，在 VS Code Marketplace / OpenVSX 上以 **「Hyper Git - Agentic Git」** 之名发布。为 VS Code 提供统一的 Git 变更管理与提交工作流（多变更分组、自绘提交面板、可视化提交图、Shelf、行级提交）。采用**路径 B**（消费 `vscode.git` 稳定 `Repository` API 为底座；稳定 API 未覆盖的能力经 `GitRepositoryService.execGit` 复用同一 git 二进制 `api.git.path` 的受控 CLI 通道实现），与原生 Source Control 平行共存、零冲突。规模：**7 视图 / 93 命令 / 6 配置项**，**280 单元测试** + 集成测试，CI 三平台矩阵全程 GREEN。完整特性见 [Release Note v0.0.6](./docs/releases/v0.0.6.md)。

### Added

#### 变更与 Changelist
- 按 Changelist 分组的 Changes 树视图：新建 / 重命名 / 删除 / 设活动列表 / 跨列表移动文件，`workspaceState` 持久化（重启恢复）；文件状态色复用 `gitDecoration.*` 主题色；单击打开原生 Diff（HEAD ↔ Working）。
- 文件级操作：丢弃改动、加入 `.gitignore`、显示文件历史。

#### Commit 提交窗口
- 自绘提交面板（WebviewView）：活动 Changelist 文件勾选 + 多行消息编辑器 + Amend / Signed-off-by / 跳过 Git Hooks + **提交** / **提交并推送**；勾选集即提交权威范围（仅提交选中的文件集合）；最近消息一键复用。
- Conventional Commits 实时校验（可配置）+ 内置 `ConventionalCommitCheck` Checkin Hook；`CommitPipeline` 责任链设计参考 JetBrains `CheckinHandler`（校验 → 暂存 → Hook 链 → 提交 → 可选推送）。

#### Log 提交图与历史
- 自绘 **Graph DAG** webview：基于父子关系自计算 lane 布局，彩色泳道 / 节点 / 分叉·合并连线 / HEAD·分支·标签徽标，`--topo-order` 保拓扑序，行宽随实际 lane 自适应；虚拟化滚动增量加载、↑↓ 键导航；选中提交内联展开变更文件并打开单文件 Diff。
- **提交图 × CI 状态**：每条提交行最右侧显示 GitHub CI 最终状态（绿勾/红叉/运行中），悬停 Tooltip 展示各项检查 + 未通过原因 + 跳转链接；复用 VS Code 内置 GitHub 认证（`vscode.authentication`，凭证不经 chat/日志/webview），仅取可见行懒加载、批量 GraphQL（≤100 oid）+ 限流冷却、终态缓存；非 GitHub 远程零图标零请求，支持 github.com 与 GitHub Enterprise；配置 `hyperGit.log.ci.{enabled,remote,provider}`。
- **Checkpointer 过滤**：Log 视图新增 Checkpointer 选项，默认剔除 AI 编码工具产生的自动快照（checkpoint）提交，提交图更干净，可按需开启。
- **7 个可组合过滤器**：作者、路径、message（grep）、message（正则）、合并模式、日期、一键清除；复制 commit hash、刷新。
- per-commit 操作：Reset 到此（soft/mixed/hard/keep）、从此新建分支 / 标签、查看包含此提交的分支、Cherry-Pick、Revert。

#### Branches 与 Tags
- 四段分组（收藏 / 本地 / 远程 / 标签）+ ahead·behind·upstream 跟踪展示；新建 / 检出 / 删除 / 重命名 / 合并 / 变基 / 从选中新建并检出；收藏切换、与当前分支比较、任意两分支比较、复制引用、清理已合并分支。
- **多选批量操作**：`createTreeView({ canSelectMany: true })` 支持框选，批量删除分支/标签、批量复制引用、批量收藏；删除前 `git branch --merged` 分类已合并/未合并并诚实分栏确认强制删除风险；仅单目标语义的操作经 `!listMultiSelection` 在多选时隐藏。
- 标签：新建（轻量/附注）、删除（多选）、检出（detached HEAD）。

#### Stash 与 Shelf
- Stash：创建、保留已暂存创建、应用、Pop、删除、从 Stash 创建分支、清空全部，按真实 `stash@{n}` 索引操作。
- Shelf（基于 patch、独立于 git stash 的改动搁置机制）：Shelve 暂存、静默 Unshelve、带 3-way 合并 Unshelve、删除；独立 TreeView。

#### 远程与冲突
- Pull / Push / Fetch（无上游分支自动选定 remote 并建立 `-u` 跟踪；`GitError.stderr` 优先暴露使失败可读）。
- 对话框：**Push…**（normal / force-with-lease / force + 推送标签）、**Update Project…**（merge / rebase）、**Merge…**（ff-only / no-ff / squash + 自定义消息）。
- 冲突兜底引导：merge/rebase/pull/cherry-pick/revert/stash-pop/unshelve 失败时检测冲突并弹「解决/中止」；自绘 **3-way Merge Editor**（OURS / RESULT 可编辑 / THEIRS + 写回 `git add`）；冲突文件「采用 Ours / Theirs」。

#### 历史编辑与高级操作
- Cherry-Pick、Revert、Reset HEAD（soft/mixed/hard/keep）、交互式 Rebase（webview：pick/squash/fixup/drop + reword + 拖拽重排，经 `GIT_SEQUENCE_EDITOR` 非交互写入）、撤销最近提交（soft）、删除提交（rebase）、Fixup（autosquash）、改写最新提交信息。

#### 编辑器内能力
- 行内提交：每个未暂存 Hunk 上方渲染 CodeLens「提交此 Hunk」→ patch 重建 + `git apply --cached` 仅暂存该 Hunk → 提交（含他处已暂存内容的二次确认）。
- 部分暂存 / 取消暂存、光标处暂存、Hunk 归属 Changelist（持久化 hunk→CL 映射）。
- Blame 行内注解：逐行作者 / 日期 / hash 显示于编辑器内，悬浮展示提交详情，文档编辑时自动清除。

#### Worktrees
- 全生命周期管理：新建（新分支 / 检出已有 / detached）、在新窗口打开、锁定 / 解锁、移动、复制路径、删除（安全 / 强制）、清理失效 Worktree、刷新。

#### 工具与配置
- 导出 / 应用 Patch、查看 Reflog、3-way Diff 概览（HEAD ↔ Staged ↔ Working）、Console 命令输出面板。
- 配置项：`hyperGit.commit.template`、`hyperGit.commit.conventional`、`hyperGit.ai.enabled`（M5 预留，暂不生效）、`hyperGit.log.ci.{enabled,remote,provider}`（提交图 CI 状态）。

#### 架构与质量
- 正交分层：`engine/`（纯逻辑，零 vscode 依赖、Vitest 可测）、`adapter/`（唯一接触 vscode API）、`agent/`（AI 接缝）、`ui/`、`shared/protocol.ts`（Webview ↔ Host 契约单一事实源）、`infra/`。
- AI 接缝预埋 5 接口 + Null 实现（`ILlmProvider` / `ICommitMessageProvider` / `IPreCommitInspector` / `IChangelistGrouper` / `IConflictResolver`），设计参考 JetBrains `CheckinHandler` 提交生命周期，M5 替换为真实实现。
- 品牌图标统一为「Git Pull Request」造型（活动栏 SVG + Marketplace 徽标 + README 头图，字形改编自 Tabler Icons，MIT）；活动栏图标实时显示未提交文件数角标。
- CI 流水线：lint → 类型 → 构建 → 三平台测试矩阵（Ubuntu/macOS/Windows，Linux 经 xvfb）→ 打包 vsix；`v*` 标签触发 GitHub Release（附带可本地安装的 `.vsix`，正文取自 `docs/releases/`）+ OpenVSX 发布；VS Code Marketplace 由 `ENABLE_MARKETPLACE_PUBLISH` 变量门控。

### 已知限制

- Commit 窗口的 Co-authored-by / Author 覆盖（`--author`）/ 撤销最近提交按钮 UI 接线（engine `trailer` 已就绪，仅缺 webview 交互）。
- Partial 多文件选择 UX、行级 split chunks（按选定行拆分提交）。
- 目录 / folder diff（虚拟文档）、Submodules 管理。
- M5 AI Agent（5 个接缝已预埋 Null 实现，本版未启动）。

[0.0.6]: https://github.com/ThreeFish-AI/hyper-git/releases/tag/v0.0.6
