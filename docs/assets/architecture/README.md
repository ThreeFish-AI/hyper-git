# archify 架构图资产索引

本目录管理由 [archify](https://github.com/tt-a1i/archify) 绘制的交互式架构图成品。**源头是 [Mermaid 源图](../mermaid/README.md)**（唯一事实源，溯源矩阵见彼处）；文档一律嵌入本目录成品，禁止内联 mermaid 围栏。

## 产物形态（每图四件套，同基名）

| 文件 | 用途 |
|---|---|
| `<基名>.html` | 交互版：聚焦/搜索/关系追踪/演示，深浅主题切换（浏览器直接打开） |
| `<基名>.light.svg` | 浅色静态版，`<picture>` 默认嵌入 |
| `<基名>.dark.svg` | 深色静态版（根节点 `data-theme="dark"`），`<picture>` 深色偏好嵌入 |
| `docs/assets/mermaid/<分类>/<基名>.mmd` | Mermaid 源图（指回本目录的路径登记在溯源矩阵） |

## 分类索引

### architecture/（工程蓝图）
| 基名 | archify 类型 | 源 Mermaid | 嵌入文档 |
|---|---|---|---|
| [engineering-plan-layers](architecture/engineering-plan-layers.html) | architecture | [engineering-plan-layers.mmd](../mermaid/architecture/engineering-plan-layers.mmd) | [engineering-plan.md](../../architecture/engineering-plan.md) · [README（中）](../../i18n/zh-CN/README.md) |
| [engineering-plan-layers-en](architecture/engineering-plan-layers-en.html) | architecture | [engineering-plan-layers-en.mmd](../mermaid/architecture/engineering-plan-layers-en.mmd) | [README.md（根，PNG 导出）](../../../README.md) |

### features/（功能特性）
| 基名 | archify 类型 | 源 Mermaid | 嵌入文档 |
|---|---|---|---|
| [log-commit-detail-panel-layout](features/log-commit-detail-panel-layout.html) | architecture | [.mmd](../mermaid/features/log-commit-detail-panel-layout.mmd) | [log-commit-detail-panel.md](../../features/log-commit-detail-panel.md) |
| [log-commit-detail-panel-dataflow](features/log-commit-detail-panel-dataflow.html) | dataflow | [.mmd](../mermaid/features/log-commit-detail-panel-dataflow.mmd) | 同上 |
| [multi-root-repo-selection-toolbar](features/multi-root-repo-selection-toolbar.html) | workflow | [.mmd](../mermaid/features/multi-root-repo-selection-toolbar.mmd) | [multi-root-repo-selection.md](../../features/multi-root-repo-selection.md) |
| [multi-root-repo-selection-sequence](features/multi-root-repo-selection-sequence.html) | sequence | [.mmd](../mermaid/features/multi-root-repo-selection-sequence.mmd) | 同上 |
| [branch-tree-group-by-prefix-effect](features/branch-tree-group-by-prefix-effect.html) | workflow | [.mmd](../mermaid/features/branch-tree-group-by-prefix-effect.mmd) | [branch-tree-group-by-prefix.md](../../features/branch-tree-group-by-prefix.md) |
| [branch-tree-group-by-prefix-dataflow](features/branch-tree-group-by-prefix-dataflow.html) | dataflow | [.mmd](../mermaid/features/branch-tree-group-by-prefix-dataflow.mmd) | 同上 |
| [file-list-group-by-directory-dataflow](features/file-list-group-by-directory-dataflow.html) | dataflow | [.mmd](../mermaid/features/file-list-group-by-directory-dataflow.mmd) | [file-list-group-by-directory.md](../../features/file-list-group-by-directory.md) |
| [agentic-git-preferences-flow](features/agentic-git-preferences-flow.html) | workflow | [.mmd](../mermaid/features/agentic-git-preferences-flow.mmd) | [agentic-git-preferences.md](../../features/agentic-git-preferences.md) |
| [claude-code-config-flow](features/claude-code-config-flow.html) | workflow | [.mmd](../mermaid/features/claude-code-config-flow.mmd) | [claude-code-config.md](../../features/claude-code-config.md) |
| [log-ci-status-dataflow](features/log-ci-status-dataflow.html) | dataflow | [.mmd](../mermaid/features/log-ci-status-dataflow.mmd) | [log-ci-status.md](../../features/log-ci-status.md) |

### research/（调研设计）
| 基名 | archify 类型 | 源 Mermaid | 嵌入文档 |
|---|---|---|---|
| [ai-agent-seams-pipeline](research/ai-agent-seams-pipeline.html) | workflow | [.mmd](../mermaid/research/ai-agent-seams-pipeline.mmd) | [05-ai-agent-seams.md](../../research/05-ai-agent-seams.md) |

### milestones/（里程碑路线）
| 基名 | archify 类型 | 源 Mermaid | 嵌入文档 |
|---|---|---|---|
| [roadmap-milestones](milestones/roadmap-milestones.html) | workflow | [roadmap-milestones.mmd](../mermaid/milestones/roadmap-milestones.mmd) | [README（中）](../../i18n/zh-CN/README.md) |
| [roadmap-milestones-en](milestones/roadmap-milestones-en.html) | workflow | [roadmap-milestones-en.mmd](../mermaid/milestones/roadmap-milestones-en.mmd) | [README.md（根，PNG 导出）](../../../README.md) |

## 绘制规范

1. **语义色彩**：组件类型语义化（前端/后端/外部系统各有专属色相），预留接缝用虚线关系表达；经典预设（classic）保证深浅主题下均高对比。
2. **双主题**：HTML 内置主题切换；SVG 导出为主题自包含文件，dark 版在根节点追加 `data-theme="dark"`。
3. **文档嵌入模板**：
   ```markdown
   <picture>
     <source media="(prefers-color-scheme: dark)" srcset="../assets/architecture/<分类>/<基名>.dark.svg">
     <img src="../assets/architecture/<分类>/<基名>.light.svg" alt="<中文图题>">
   </picture>

   > [交互版](../assets/architecture/<分类>/<基名>.html) · [Mermaid 源图](../assets/mermaid/<分类>/<基名>.mmd)（图资产溯源见 [图资产索引](../assets/mermaid/README.md)）
   ```
4. **质量门槛**：候选须通过 archify showcase 全检（9 项 artifact 检查零错误零警告）+ `visual-check` 浏览器证据（1440×900 等桌面首屏无溢出）。
5. **变更顺序**：改 Mermaid 源 → 重绘本目录成品 → 更新 [溯源矩阵](../mermaid/README.md)。
6. **双语变体（`-en` 后缀）**：根 README 为英文时需英文标注图——以 `<基名>-en` 为基名镜像中文版创作（拓扑、节点 id、配色不变，仅译标签；HTML/SVG 为英文 title/aria 与 `lang="en"`）；中文版拓扑变更时，`-en` 版与 `media/diagrams/` 导出须同步重绘。无后缀基名即中文默认版。
7. **根 README PNG 导出（Marketplace 兼容）**：根 `README.md` 同时是扩展店面 README（Marketplace / Open VSX 不渲染 SVG，且 `docs/**` 不入 vsix），故根 README 嵌入 `media/diagrams/<基名>-en.{light,dark}.png`（自交互 HTML 经 `?theme=light/dark` 以 2x 栅格化导出），仍用 `<picture>` 模板；`docs/` 下文档一律按模板嵌入 SVG。若发布后 Marketplace 图缺失，回退为 `#gh-dark-mode-only` / `#gh-light-mode-only` 双 `<img>` 片段方案（GitHub 两者均支持，仅需改根 README 嵌入块）。
