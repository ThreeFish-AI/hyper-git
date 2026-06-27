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

详见[工程实施方案](./.claude/plans)（决策循证基线）与[知识索引](./.agents/knowledge-map.md)。

## 路线图

| 里程碑 | 主题 | 状态 |
|---|---|---|
| **M0** | 脚手架 + CI | ✅ 进行中 |
| M1 | Git Adapter + Changes TreeView（多 changelist） | ⏳ |
| M2 | Commit 提交窗口（模板 / Amend / CC 校验 / hook 链） | ⏳ |
| M3 | Log 提交图 + Branches + Diff/Blame | ⏳ |
| M4 | Shelf + Partial/行级提交 + Stash UI | ⏳ |
| M5 | AI Agent（实现接缝） | ⏳ |

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
