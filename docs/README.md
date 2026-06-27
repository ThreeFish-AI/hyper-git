# Hyper Git 文档中心

> 项目文档与调研资产索引。所有决策均循证（附 GitHub 源码路径 / 官方文档 URL）。

## 工程方案与需求基线（高频引用）
- [工程实施方案](./architecture/engineering-plan.md) — 全链路调研结论 + 路径 B 架构 + M0-M5 里程碑路线图 + 风险与验证（**开发蓝图**）。
- [IDEA 功能复刻矩阵](./requirements/idea-feature-matrix.md) — 56 个原子功能点 / 8 组 + CheckinHandler 生命周期（**验收基线**）。

## 调研报告（循证依据）
- [02 · VS Code SCM API 与 vscode.git 集成路径](./research/02-vscode-scm-integration.md) — 路径 B 决策依据、SCM 稳定/proposed API 边界、changelist 模型映射。
- [03 · VS Code 扩展工程蓝图](./research/03-extension-blueprint.md) — 技术栈决策、工程骨架、IDEA→VS Code UI 表面映射表。
- [04 · 发布策略 + CI/CD](./research/04-publishing-cicd.md) — 双市场（Marketplace + OpenVSX）、CI 矩阵、版本治理、安全。
- [05 · AI Agent 架构预留](./research/05-ai-agent-seams.md) — AI 接缝（ILlmProvider 等）+ IDEA CheckinHandler 对齐 + 渐进式引入路线。

## 协作与规范
- [AGENTS.md](../AGENTS.md) — 协作协议与工程行为准则。
- [知识索引](../.agents/knowledge-map.md) · [Issue 记录](../.agents/issue.md) · [引用规范 IEEE](../.agents/reference-specifications.md)。
