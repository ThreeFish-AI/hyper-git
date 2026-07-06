# 发布说明（Release Notes）

> 各正式版本的发布说明，面向用户、覆盖该版本的全部特性。

本目录是 GitHub Release 正文的**单一事实源**：CI 在推送 `v*` 标签时，由 `github-release` job 经 `body_path: docs/releases/${tag}.md` 取对应文件作为 Release 正文（详见 [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)）。因此**每个 `v*` 标签都必须先有同名 Release Note 文件**，否则发布会失败——这是有意的发布纪律闸门。

## 版本索引

| 版本 | 说明 | 日期 |
|---|---|---|
| [v0.0.14](./v0.0.14.md) | 修复 GRAPH 视图提交记录时间倒序（`--topo-order` → `--author-date-order`） | 2026-07-06 |
| [v0.0.13](./v0.0.13.md) | 视图容器由活动栏迁移至底部 Panel（Terminal 之后） | 2026-07-05 |
| [v0.0.12](./v0.0.12.md) | 提交详情光标跟随悬浮卡 · Tooltip 交互修复 · 侧边栏布局优化 · 依赖升级基线（TS6 / vitest4 / vite8） | 2026-07-04 |
| [v0.0.11](./v0.0.11.md) | 首个正式版（承载 0.0.10 内容）· Graph 视图对齐官方 · 发布渠道收敛 Marketplace | 2026-07-04 |
| [v0.0.9](./v0.0.9.md) | 视图整合 · UI 系统化 · 分支与 CI 增强（自 v0.0.6 全量） | 2026-07-04 |
| [v0.0.6](./v0.0.6.md) | 首个 MVP 正式版（以「Hyper Git - Agentic Git」之名上架） | 2026-06-30 |

## 相关文档

- [CHANGELOG](../../CHANGELOG.md) — 工程视角的逐版本变更记录（Added / Changed / Fixed）。
- [README](../../README.md) — 项目说明、能力总览与开发指南。
- [文档中心](../README.md) — 全部文档与调研资产索引。
