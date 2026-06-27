# Changelog

本项目的所有重要变更均记录于此文件。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
