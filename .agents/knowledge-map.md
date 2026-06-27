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
- [工程实施方案](../docs/architecture/engineering-plan.md) — 路径 B 架构 + M0-M5 里程碑（**开发蓝图**）。
- [IDEA 功能复刻矩阵](../docs/requirements/idea-feature-matrix.md) — 56 功能点 / 8 组（**验收基线**）。
- [调研报告](../docs/research/README.md) — SCM 集成 / 工程蓝图 / 发布 CI / AI 接缝四路循证报告。

## 架构分层（src/）
> 依赖方向单向：`UI → Adapter → Engine`；`Agent` 以接口注入 `Engine`/`CommitPipeline`，不反向依赖 UI。

- `engine/` — 纯领域逻辑（零 vscode 依赖，Vitest 可测）：`model/`、`scm-mapping/`、`commit/pipeline.ts`、`diff/`(M4)。
- `adapter/` — 唯一接触 vscode API：`GitRepositoryAdapter`、`ChangelistRegistry`、`tree/`、`webview/`、`diff/`、`storage/`（M1+）。
- `agent/` — AI 接缝（M5 实现）：`ILlmProvider`、`IPreCommitInspector`、`IChangelistGrouper`、`IConflictResolver`、`IChatToolRegistrar`。
- `shared/protocol.ts` — Webview ↔ Host 消息契约【单一事实源】。
- `infra/` — 日志（OutputChannel）/ 错误处理 / 事件总线 / 配置。

## 里程碑
M0 脚手架 + CI ✅ → M1 Git Adapter + Changes（多 changelist）→ M2 Commit 窗口 → M3 Log/Branches/Diff → M4 Shelf/Partial/Stash → M5 AI Agent。
