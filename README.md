# Hyper Git

> 在 VS Code 上完整复刻 IntelliJ IDEA 的 **Git 工具窗口** 与 **Commit 提交窗口**，并为未来 git 管理的 AI Agent 自主代理能力预留架构接缝。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

## 为什么需要 Hyper Git

IntelliJ IDEA 的统一 Git 工具窗口（顶部 `Commit / Shelf / Stash` 标签页 + Changes 变更树 + Commit Message 编辑区 + 提交前 Inspection）是开发者高频依赖的工作流。迁移到 VS Code 后，原生 Source Control 视图**缺少**：多 changelist、忠实的 Commit 窗口、提交前检查流水线、Shelf/行级提交等能力。Hyper Git 旨在 1:1 补齐这一体验。

## 架构（路径 B：消费 + 自绘）

- **消费** 内置 `vscode.git` 扩展导出的稳定 `Repository` API 作为 git 操作底座（不重造 git 状态机）。
- **自建** changelist registry（IDEA 的 active 列表 / 跨列表行级归属无法用原生 SCM group 表达）。
- **自绘** 独立视图容器承载 IDEA 风格 UI，与原生 Source Control 视图零冲突、平行共存。
- **AI**：现仅预留接口接缝（`ILlmProvider` / `IPreCommitInspector` 等，对齐 IDEA `CheckinHandler` 生命周期），实现延后至 M5。

## 功能（v0.0.1-rc.1）

- **多 changelist Changes 视图**：active 列表、新建/删除/重命名/移动，`workspaceState` 持久化（重启恢复）；文件状态色复用 `gitDecoration.*` 主题色。
- **Commit 提交窗口**：多行编辑器 + Conventional Commits 实时校验 + Amend / Signed-off-by / 跳过 Git hooks + Commit / Commit and Push；勾选集为提交权威范围；最近消息复用。
- **Log 提交历史**：按作者/路径过滤、清除过滤、复制 commit hash、显示文件历史。
- **Branches**：本地/远程分组、活动分支高亮；新建/检出/删除/合并/变基（rebase）。
- **Stash**：create / apply / pop / drop（作用于 stash@{0} 最新）。
- **其他**：Discard 改动、Pull / Push / Fetch、Blame、Diff（HEAD ↔ Working）。

## 安装

- **VS Code Marketplace**：搜索 `Hyper Git`（发布后）。
- **OpenVSX**（Cursor / Windsurf / Gitpod / VSCodium）：同 `Hyper Git`。
- **手动**：从 [Releases](https://github.com/ThreeFish-AI/hyper-git/releases) 下载 `.vsix`（形如 `hyper-git-0.0.4.vsix`）→ 命令面板 `Extensions: Install from VSIX`。
- **要求**：VS Code ≥ 1.85.0 + 启用内置 Git 扩展（`vscode.git`，默认随附）。

## 已知限制

> vscode.git 稳定 API 不含 cherry-pick / revert / reset / 分支重命名 / hunk 暂存 / stash list / graph topology / shelf / author 覆盖等；**这些均已通过 `GitRepositoryService.execGit`（复用 `api.git.path` 同一 git 二进制）的受控 CLI 通道实现**（Batch 5-12 全量对齐，详见 [CHANGELOG](./CHANGELOG.md) [Unreleased]）。

当前仍待补：

- Commit 窗口的 Co-authored-by / Author 覆盖（`--author`）/ undo-last-commit **按钮 UI 接线**（engine `trailer` 已就绪，仅缺 webview 交互）。
- Partial 多文件选择 UX、行级 split chunks（IDEA "Include Selected Lines"）。
- 目录 / folder diff（虚拟文档）、Submodules 管理。
- M5 AI Agent（5 个接缝已预埋 Null 实现，本轮未启动）。

详见[工程实施方案](./docs/architecture/engineering-plan.md)、[实施状态总览](./docs/milestones/implementation-status.md)与[知识索引](./.agents/knowledge-map.md)。

## 路线图

| 里程碑 | 主题 | 状态 |
|---|---|---|
| M0 | 脚手架 + CI | ✅ |
| M1 | Git Adapter + Changes TreeView（多 changelist） | ✅ |
| M2 | Commit 提交窗口（模板 / Amend / CC 校验 / hook 链） | ✅ |
| M3 | Log + Branches + Diff/Blame | ✅ |
| M4 | Stash / Shelf MVP | ✅ |
| M5 | AI Agent（实现接缝） | ⏳ 留存设计，暂不实施 |

> ⚠️ vscode.git 稳定 API 不含 cherry-pick / revert / reset / 分支重命名 / 行级 hunk 暂存；这些 IDEA 功能暂不可用（详见[实施状态 §3](./docs/milestones/implementation-status.md#3-api-限制汇总vscodegit-稳定-api-边界)）。

## 开发

```bash
pnpm install                  # 安装依赖
pnpm run compile              # 类型检查 + lint + 构建
pnpm run watch                # 监听构建（F5 启动 Extension Host 调试）
pnpm run test:unit            # 单元测试（engine 纯逻辑，Vitest）
pnpm run test:integration     # 集成测试（@vscode/test-electron）
pnpm run package              # 生产构建
pnpm dlx @vscode/vsce package # 打包 .vsix
```

> 包管理与脚本统一使用 `pnpm`（遵循 [AGENTS.md](./AGENTS.md) 工程规范）。

## 许可证

[MIT](./LICENSE)
