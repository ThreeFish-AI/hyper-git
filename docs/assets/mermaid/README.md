# Mermaid 源图资产（单一事实源）

本目录集中管理全项目 Mermaid 源图。**Mermaid 是 archify 专业图的唯一源头**：先抽取并校准 `.mmd`，再由 archify 依其绘制交互式成品（见 [archify 图资产索引](../architecture/README.md)）；文档一律嵌入 archify 成品，禁止内联 mermaid 围栏。

## 溯源矩阵（唯一权威映射）

| Mermaid 源 | 图类型 | 源文档（原行区间） | archify 成品 | 嵌入文档 | 校准记录 | 状态 |
|---|---|---|---|---|---|---|
| [engineering-plan-layers.mmd](architecture/engineering-plan-layers.mmd) | flowchart TB · 架构分层 | [engineering-plan.md](../../architecture/engineering-plan.md) L36-84 | [engineering-plan-layers.html](../architecture/architecture/engineering-plan-layers.html) | engineering-plan.md | 对照 v0.0.18 源码纠偏：Changes TreeView 已移除（v0.0.13 视图迁底部 Panel）、adapter 组件实名、Engine 15 模块、AI 接缝经 CommitService 注入；详见源文档「现状校准」注记 | ✅ 2026-09-11 |
| [ai-agent-seams-pipeline.mmd](research/ai-agent-seams-pipeline.mmd) | flowchart TD · Commit 流水线 hook | [05-ai-agent-seams.md](../../research/05-ai-agent-seams.md) L150-177 | [ai-agent-seams-pipeline.html](../architecture/research/ai-agent-seams-pipeline.html) | 05-ai-agent-seams.md | 待校准（对照 `src/agent/` 五接缝与 `engine/commit/`） | ⏳ |
| [log-commit-detail-panel-layout.mmd](features/log-commit-detail-panel-layout.mmd) | flowchart TB · 面板布局 | [log-commit-detail-panel.md](../../features/log-commit-detail-panel.md) L17-41 | [log-commit-detail-panel-layout.html](../architecture/features/log-commit-detail-panel-layout.html) | log-commit-detail-panel.md | 待校准（对照 `log-webview.ts` 分栏与标题栏） | ⏳ |
| [log-commit-detail-panel-dataflow.mmd](features/log-commit-detail-panel-dataflow.mmd) | flowchart LR · 取数数据流 | 同上 L50-65 | [log-commit-detail-panel-dataflow.html](../architecture/features/log-commit-detail-panel-dataflow.html) | 同上 | 待校准（对照 `protocol.ts` `log/commitDetail` `forHash` 守卫） | ⏳ |
| [multi-root-repo-selection-toolbar.mmd](features/multi-root-repo-selection-toolbar.mmd) | flowchart LR · 切换入口 | [multi-root-repo-selection.md](../../features/multi-root-repo-selection.md) L7-18 | [multi-root-repo-selection-toolbar.html](../architecture/features/multi-root-repo-selection-toolbar.html) | multi-root-repo-selection.md | 待校准（对照 `repository-selection.ts`） | ⏳ |
| [multi-root-repo-selection-sequence.mmd](features/multi-root-repo-selection-sequence.mmd) | sequenceDiagram · 切换时序 | 同上 L28-43 | [multi-root-repo-selection-sequence.html](../architecture/features/multi-root-repo-selection-sequence.html) | 同上 | 已实锤：`onDidChangeRepository` 先于 `onDidChange` fire（`git-repository-service.ts`） | ⏳ |
| [branch-tree-group-by-prefix-effect.mmd](features/branch-tree-group-by-prefix-effect.mmd) | flowchart LR · 前缀树效果 | [branch-tree-group-by-prefix.md](../../features/branch-tree-group-by-prefix.md) L7-26 | [branch-tree-group-by-prefix-effect.html](../architecture/features/branch-tree-group-by-prefix-effect.html) | branch-tree-group-by-prefix.md | 待校准 | ⏳ |
| [branch-tree-group-by-prefix-dataflow.mmd](features/branch-tree-group-by-prefix-dataflow.mmd) | flowchart LR · 算树数据流 | 同上 L34-43 | [branch-tree-group-by-prefix-dataflow.html](../architecture/features/branch-tree-group-by-prefix-dataflow.html) | 同上 | 已实锤：`buildRefTree` 位于 `engine/ref/ref-tree.ts` | ⏳ |
| [file-list-group-by-directory-dataflow.mmd](features/file-list-group-by-directory-dataflow.mmd) | flowchart LR · 目录树数据流 | [file-list-group-by-directory.md](../../features/file-list-group-by-directory.md) L9-18 | [file-list-group-by-directory-dataflow.html](../architecture/features/file-list-group-by-directory-dataflow.html) | file-list-group-by-directory.md | 已实锤：`buildFileTree` 位于 `engine/tree/file-tree.ts` | ⏳ |
| [agentic-git-preferences-flow.mmd](features/agentic-git-preferences-flow.mmd) | flowchart LR · 偏好流向 | [agentic-git-preferences.md](../../features/agentic-git-preferences.md) L10-31 | [agentic-git-preferences-flow.html](../architecture/features/agentic-git-preferences-flow.html) | agentic-git-preferences.md | 待校准（对照 `package.json` `hyperGit.agent.*`） | ⏳ |
| [claude-code-config-flow.mmd](features/claude-code-config-flow.mmd) | flowchart LR · 配置流向 | [claude-code-config.md](../../features/claude-code-config.md) L17-43 | [claude-code-config-flow.html](../architecture/features/claude-code-config-flow.html) | claude-code-config.md | 待校准（对照 `claude-commands.ts` / `engine/agent/claude-path.ts`） | ⏳ |
| [log-ci-status-dataflow.mmd](features/log-ci-status-dataflow.mmd) | flowchart LR · CI 取数 | [log-ci-status.md](../../features/log-ci-status.md) L9-31 | [log-ci-status-dataflow.html](../architecture/features/log-ci-status-dataflow.html) | log-ci-status.md | 待校准（对照 `engine/ci/` + `adapter/ci/` + `protocol.ts`） | ⏳ |

## 管理规则

1. **变更顺序**：先改本目录 `.mmd` → 再同步 archify 成品（HTML + 深浅色双 SVG）→ 更新本矩阵状态。
2. `.mmd` 文件头注释仅存轻量指针（源文档/成品路径）；映射关系以本矩阵为唯一权威，避免双源。
3. 文档嵌入统一模板：`<picture>` 深浅色自适应 + 交互版 HTML / Mermaid 源图双链接。
4. 每张成品四件套同基名：`<基名>.mmd` ↔ `<基名>.{html, light.svg, dark.svg}`。
