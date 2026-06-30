# 调研报告索引（循证依据）

> 五路并行调研（JetBrains 源码借鉴 / VS Code SCM API / 开发实践 / 发布 CI / AI Agent）的完整报告。
> 所有事实论断附 GitHub 源码路径或官方文档 URL；不确定项标注「待核实」。
> 调研日期：2026-06-27。

| # | 报告 | 核心结论 |
|---|---|---|
| 01 | [Git 功能完备性矩阵](../requirements/idea-feature-matrix.md) | 56 功能点 / 8 组；多 changelist + 行级跨列表归属是 VS Code 原生模型与成熟实现的最大差异 |
| 02 | [VS Code SCM 集成路径](./02-vscode-scm-integration.md) | **路径 B**：消费 vscode.git API + 自建 changelist registry + 自绘视图；scmHistoryProvider 等仍 proposed |
| 03 | [扩展工程蓝图](./03-extension-blueprint.md) | TS+esbuild+Vitest+test-electron；engine/adapter/agent/ui 正交分层 |
| 04 | [发布 + CI/CD](./04-publishing-cicd.md) | 双市场（Cursor/Windsurf 走 OpenVSX）；CI 三平台 + xvfb；版本不可撤销 |
| 05 | [AI Agent 接缝](./05-ai-agent-seams.md) | ILlmProvider/IPreCommitInspector 现在抽（借鉴 JetBrains CheckinHandler 责任链设计），实现延后 M5 |

> 综合方案见 [工程实施方案](../architecture/engineering-plan.md)。
