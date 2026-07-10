# Knowledge Map（知识索引）

> 项目内文档与关键能力索引；按主题正交分组，链接为相对路径以便跨上下文跳转。
> 新增/变更文档时应即时同步本表。

## 工程协议与基线
- [AGENTS.md](../AGENTS.md) — 协作协议与工程行为准则（熵减心法 / 架构原则 / 执行规范）。
- [README.md](../README.md) — Hyper Git 项目说明、架构（路径 B）与 M0-M5 路线图。
- [CHANGELOG.md](../CHANGELOG.md) — 版本变更记录（Keep a Changelog 格式）。
- [LICENSE](../LICENSE) — MIT。

## Agents 知识库（本目录）
- [Issue 记录](./issue.md) — 跨上下文问题处理经验（表因 / 根因 / 处理 / 防范）。
- [引用规范 IEEE](./reference-specifications.md) — 文献引用格式与上标锚定。
- [浏览器验证协议](./browser-validation.md) — OAuth/SSO 红线与 E2E 验证协议。

## 项目文档（docs/）
- [文档中心](../docs/README.md) — 文档与调研资产总索引。
- [README（简体中文）](../docs/i18n/zh-CN/README.md) — 根 README 的中文版本（根路径为英文版，i18n 目录沉淀中文）。
- [Log 视图 CI 状态](../docs/features/log-ci-status.md) — 按提交显示 GitHub CI 最终状态（绿勾/红叉 + Tooltip 明细）：认证、限流、懒加载、边界与配置。
- [Commit 视图整合](../docs/features/commit-view-consolidation.md) — 移除 CHANGES 视图，其文件操作/changelist 管理/Git 工具栏/未提交角标零回归平移入 Commit 视图。
- [变更文件目录树](../docs/features/file-list-group-by-directory.md) — Commit / Log 文件列表「平铺 ⇄ 按目录分组」切换：host 侧 `buildFileTree` 构树下发、compact 折叠、目录三态。
- [分支前缀分组树](../docs/features/branch-tree-group-by-prefix.md) — Branches 视图 Local/Remote/Tags「平铺 ⇄ 按 `/` 前缀分组」切换：`buildRefTree` 构树、分支感知排序、compact 折叠、隐藏 `origin/HEAD`、按仓库持久化。
- [Log 提交悬浮详情](../docs/features/log-commit-tooltip.md) — 悬停提交行浮层展示 分支/标签/HEAD/完整消息/作者·提交者/时间/SHA；复用 CI 浮层范式、与其互斥。
- [Claude Code 配置](../docs/features/claude-code-config.md) — Agentic Git 预置：`hyperGit.claudeCode.executablePath` 设置 + `~/.claude/settings.json` 快捷入口（原生设置 + 命令；纯路径逻辑沉淀 `engine/agent/`）。
- [实施状态总览](../docs/milestones/implementation-status.md) — M0-M5 交付记录 + API 限制 + M5 AI 设计 + 验证/发布（**实施看板**）。
- [工程实施方案](../docs/architecture/engineering-plan.md) — 路径 B 架构 + M0-M5 里程碑（**开发蓝图**）。
- [Git 功能矩阵](../docs/requirements/idea-feature-matrix.md) — 56 功能点 / 8 组（**验收基线**，参考 IDEA 等成熟实现）。
- [调研报告](../docs/research/README.md) — SCM 集成 / 工程蓝图 / 发布 CI / AI 接缝四路循证报告。
- [发布说明](../releases/README.md) — 各正式版 Release Notes（GitHub Release 正文单一事实源；最新 [v0.0.14](../releases/v0.0.14.md)）。

## 架构分层（src/）
> 依赖方向单向：`UI → Adapter → Engine`；`Agent` 以接口注入 `Engine`/`CommitPipeline`，不反向依赖 UI。

- `engine/` — 纯领域逻辑（零 vscode 依赖，Vitest 可测）：`model/`、`scm-mapping/`、`commit/pipeline.ts`、`diff/`(M4)。
- `adapter/` — 唯一接触 vscode API：`GitRepositoryAdapter`、`ChangelistRegistry`、`tree/`、`webview/`、`diff/`、`storage/`（M1+）。
- `agent/` — AI 接缝（当前 5 接口，均 Null 实现，完整逻辑延后至 M5）：`ILlmProvider`、`ICommitMessageProvider`、`IPreCommitInspector`、`IChangelistGrouper`、`IConflictResolver`（另有规划中的第 6 接缝 `IChatToolRegistrar`，详见[调研报告](../research/05-ai-agent-seams.md)）。
- `shared/protocol.ts` — Webview ↔ Host 消息契约【单一事实源】。
- `infra/` — 日志（OutputChannel）/ 错误处理 / 事件总线 / 配置。

## 里程碑
M0 脚手架 + CI ✅ → M1 Git Adapter + Changes（多 changelist）→ M2 Commit 窗口 → M3 Log/Branches/Diff → M4 Shelf/Partial/Stash → M5 AI Agent。
