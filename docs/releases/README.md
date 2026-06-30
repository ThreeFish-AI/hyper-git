# 发布说明（Release Notes）

> 各正式版本的发布说明，面向用户、覆盖该版本的全部特性。

本目录是 GitHub Release 正文的**单一事实源**：CI 在推送 `v*` 标签时，由 `github-release` job 经 `body_path: docs/releases/${tag}.md` 取对应文件作为 Release 正文（详见 [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)）。因此**每个 `v*` 标签都必须先有同名 Release Note 文件**，否则发布会失败——这是有意的发布纪律闸门。

## 版本索引

| 版本 | 说明 | 日期 |
|---|---|---|
| [v0.0.1](./v0.0.1.md) | 首个 MVP 正式版 | 2026-06-30 |

## 相关文档

- [CHANGELOG](../../CHANGELOG.md) — 工程视角的逐版本变更记录（Added / Changed / Fixed）。
- [README](../../README.md) — 项目说明、能力总览与开发指南。
- [文档中心](../README.md) — 全部文档与调研资产索引。
