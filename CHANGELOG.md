# Changelog

本项目的所有重要变更均记录于此文件。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
