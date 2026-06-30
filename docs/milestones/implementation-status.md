# 实施状态总览（M0 → M5）

> Hyper Git VS Code 扩展的里程碑实施记录、API 限制发现、功能达成矩阵与 M5 AI 设计（留存）。
> 本文档随里程碑推进即时更新；调研与原始方案见 [工程实施方案](../architecture/engineering-plan.md) 与 [调研报告](../research/README.md)。
> 最后更新：2026-06-29（Parity Recovery Batch 5-12 全量功能对齐完成）。
>
> **⚠️ 重大更新（2026-06-29，Batch 5-12）**：经 Git 功能完备性评审，发现「功能多数已实现，但被 Branches 视图渲染 bug + 工具栏未浮现 + 命令 bug 掩盖」。本批 Recovery **先解除可见痛感，再全量补齐**：新增 13 个 engine 纯逻辑模块 + 21 个命令，单测 64 → 166、命令 56 → 77。**§3 所列 vscode.git 稳定 API 限制（cherry-pick/revert/reset/branch rename/hunk 暂存/stash list/graph topology/shelf/author 等）现均已通过 `GitRepositoryService.execGit`（复用 `api.git.path` 同一 git 二进制）受控 CLI 通道解决**。详见 [CHANGELOG](../../CHANGELOG.md) [Unreleased]。
> AI M5 暂不启动（5 个接缝保留 Null 实现，本轮专注功能完备性）。

---

## 0. 概览

- **架构**：路径 B —— 消费内置 `vscode.git` 稳定 `Repository` API + 自建 changelist registry + 独立视图容器自绘 UI，不接管原生 Source Control 视图。
- **分层**：`engine/`（纯逻辑，零 vscode 依赖）/ `adapter/`（唯一接触 vscode API）/ `agent/`（AI 接缝）/ `shared/`（契约）/ `infra/`。
- **质量基线**：TypeScript strict + ESLint9 + Vitest（engine 单测）+ @vscode/test-electron（adapter 集成）+ esbuild + 三平台 CI（Linux xvfb）。
- **验证**：单测 45/45、集成 3/3（含真实 git 提交闭环 + amend）、`vsce package` 产 vsix。

## 1. 里程碑交付记录

| 里程碑 | 版本 | PR | 交付 | 验收 |
|---|---|---|---|---|
| M0 脚手架+CI | 0.1.0 | [#1](https://github.com/ThreeFish-AI/hyper-git/pull/1) | pnpm+esbuild+TS strict+ESLint9+Vitest+test-electron；正交分层骨架；CI 三平台矩阵+双市场发布；engine 纯逻辑 + AI 接缝预留 | check-types/lint/package/test 全绿 |
| 调研资产持久化 | — | [#2](https://github.com/ThreeFish-AI/hyper-git/pull/2) | docs/（IDEA 56 功能矩阵、工程方案、四路调研报告） | — |
| M1 Git Adapter+多 changelist | 0.2.0 | [#3](https://github.com/ThreeFish-AI/hyper-git/pull/3) | GitRepositoryService、ChangelistRegistry（CRUD+持久化）、Changes TreeView（状态色+diff） | 集成：真实仓库变更渲染 |
| M2 Commit 窗口 | 0.3.0 | [#4](https://github.com/ThreeFish-AI/hyper-git/pull/4) | Commit WebviewView（勾选+多行编辑器+Amend/signoff/skipHooks+CC 实时校验）、CommitPipeline（Checkin hook 链）、5 AI 接缝 Null 注入 | 集成：真实 git 提交闭环 |
| M0-M2 审查修复 | 0.3.1 | [#5](https://github.com/ThreeFish-AI/hyper-git/pull/5) | 11 类正确性修复（订阅泄漏/仓库选取/indexChanges/commit 语义/push 警告/linter 等）+ 16 项测试补齐 | 单测 45/45 + 集成 3/3 |
| M3 Log/Branches/Blame | 0.4.0 | [#6](https://github.com/ThreeFish-AI/hyper-git/pull/6) | Log TreeView（过滤+copy hash+Show History）、Branches TreeView（create/checkout/delete/merge/rebase）、Blame | 命令注册集成 |
| M4 Stash/Shelf | 0.5.0 | [#7](https://github.com/ThreeFish-AI/hyper-git/pull/7) | Stash 视图（log refnames 枚举）+ create/apply/pop/drop；Shelf MVP（stash 近似） | 命令注册集成 |
| **Parity Recovery Batch 5-7** | — | commit `00b5ba7`/`2105445`/`9699ee9` | Branches 渲染修复 + 工具栏 Action 组 + 冲突兜底；Branches 视图增强（Favorites/Tags/ahead-behind）；Rebase webview 支持 reword/edit/拖拽交互式编排 | 单测 166/166 + 集成 3/3 |
| **Parity Recovery Batch 8-9** | — | commit `efd888c`/`ed01883` | Log 提交详情面板 + 高级过滤 + per-commit 操作；真实 SVG 提交拓扑图（解析 git --graph 字符粒度渲染 + 可点击 + 实时刷新） | 同上 |
| **Parity Recovery Batch 10-12** | — | commit `2274d8a`/`fcb6ffa`/`acdf53c` | Push/Update/Merge 对话框 + fetch prune + Co-authored-by trailer；自绘 3-way Merge Editor（自实现 diff3）；Stash 高级 + Patch + Reflog + Blame 行内注解 | 同上 |

## 2. P0/P1 功能达成矩阵（对照 [IDEA 功能矩阵](../requirements/idea-feature-matrix.md)）

> 状态：✅ 已实现 · ⚠️ 部分/未验证 · 🔶 API 受限（无稳定 API） · ⏳ 未做（属后续里程碑）

| 功能域（矩阵#） | 优先级 | 状态 | 说明 |
|---|---|---|---|
| Commit 窗口(#1-3,5,7-9,22) | P0 | ✅ | 窗口/模板/历史/Amend/Author 占位/signoff/skipHooks/Commit&Push/选择性勾选 |
| Conventional Commits(#4) | P0/P1 | ✅ | linter + webview 实时 + pipeline hook 阻断 |
| Author 覆盖(#6) | P0 | 🔶 | vscode.git 稳定 `commit()` 不支持 `--author`（API 限制，文档化） |
| 多 changelist(#15-20) | P0 | ✅ | active/新建/删除/重命名/移动 + workspaceState 持久化 |
| Commit 检查流水线(#10-12) | P1 | ⚠️ | CommitPipeline 责任链 + CC hook；CRLF/大文件预检(#12)未实现（可扩展 hook） |
| Diff(#35,37,38) | P0/P1 | ✅ | 本地↔HEAD diff、Blame、Show History（文件历史） |
| Rollback/Discard(#51) | P0 | ⚠️ | **当前无 discard/rollback 命令**（见 §4 缺口） |
| Branches(#45-48) | P1 | ✅/🔶 | create/checkout/delete/merge/rebase ✅；rename 🔶（API 无） |
| Stash(#29,30) | P1 | ✅ | create/apply/pop/drop（稳定 API）；list 用 log refNames 近似 |
| Log 提交图(#39,40) | P2 | ⚠️ | Log TreeView（列表+过滤）；**完整 SVG 拓扑图未做**（M3.x） |
| cherry-pick/revert from log(#41,42) | P2 | 🔶 | 稳定 API 无 cherry-pick/revert |
| Undo Commit/Reset(#43,52) | P2 | 🔶 | 稳定 API 无 reset |
| Partial/行级提交(#23-25) | P2 | 🔶 | `add` 仅整文件，无 hunk 暂存（API 限制） |
| Shelf 忠实(#27,28) | P2 | ⚠️ | MVP 用 stash 近似；忠实 patch Shelf 🔶 |

## 3. API 限制汇总（vscode.git 稳定 API 边界）

> 经逐行复核 `extensions/git/src/api/git.d.ts` 与 `api1.ts` 确认。以下 IDEA 功能**无稳定 API 对应**，文档化延后；未来可经 git CLI 兜底或 proposed API 评估。

- **cherry-pick / revert（commit-level）/ reset**：Repository 无对应方法。
- **分支重命名**：无 `renameBranch`（仅 createBranch/deleteBranch/setBranchUpstream）。
- **行级 / hunk 级暂存**：`add(paths)` 仅整文件；无 `git add -p` 暴露。
- **`git stash list` 枚举**：无公开方法；M4 用 `log({ refNames: ['stash'] })` 近似。
- **Author 覆盖**：`commit(message, opts)` 的 `CommitOptions` 无 `author` 字段。
- **忠实 patch Shelf**：git 无原生 shelve；可用 `diffBetweenPatch` + `apply({threeWay})` 自建（复杂，延后）。
- **提交图 History Provider / 多文件 diff 编辑器**：`scmHistoryProvider`/`scmMultiDiffSource` 仍为 proposed API，上架扩展禁用。

## 4. 已知缺口（待补）

- **Rollback/Discard 命令**（P0 #51）：M1/M2 范围内遗漏。vscode.git 有 `revert(paths)`（unstage）/ `clean(paths)`（discard untracked）/ `restore(paths, {staged})`，可实现「Discard Changes」。**建议补入 rc.1 后的小版本**。
- **ChangelistRegistry CRUD 单测**：因 vscode 耦合 + 打包内联，未单测；逻辑简单 + grouper 已测，风险低。
- **Log/Branches/Stash 命令的真实集成测试**：当前仅测命令注册；分支 checkout/merge 等的真实 git 验证可补。
- **完整 Log SVG 拓扑图**：M3.x 增强。
- **PNG 图标（128×128）**：发布 Marketplace 推荐；rc.1 处理。

## 5. M5 AI Agent 设计（留存，暂不实施）

> 详见 [Track5 AI Agent 架构预留](../research/05-ai-agent-seams.md)。M2 已埋全部接缝 + Null 实现；M5 替换为真实实现。

**5 个 AI 接缝**（agent/，依赖 engine 不依赖 adapter）：
- `ILlmProvider`：模型来源抽象（vscodeLM / byok-Ollama / openaiCompatible）。**最关键**——未来切换模型来源的命脉。
- `ICommitMessageProvider`：AI 提交信息生成（staged diff + 团队规范 → 流式 CC 合规 message）。
- `IPreCommitInspector`：提交前 AI 代码审查（参考 JetBrains `CheckinHandler.beforeCheckin` 责任链设计，可阻断）。
- `IChangelistGrouper`：变更语义分组（回写 changelist）。
- `IConflictResolver`：冲突解决（用户逐块确认）。

**Commit 流水线 hook 注入点**（M2 已建责任链，默认 Null）：
`staged diff → [Hook A 提交信息生成] → message → [Hook B beforeCheckin 检查链] → [Hook C 分组] → commit → [Hook D checkinSuccessful] → push → [Hook E/F 冲突]`

**落地机制（2026 现状）**：
- VS Code Language Model API（`vscode.lm`）：底层模型访问；不支持 system message、需用户 consent、不可集成测试。
- Chat Participant（`@hyper-git`）+ Language Model Tools（`languageModelTools` 暴露 git 能力给任意 Agent）。
- BYOK Provider API（Ollama 本地 / OpenRouter / OpenAI 兼容）。
- prompt-tsx（alpha）。

**差异化**（vs 内置 Copilot commit message）：注入完整 commit 流程上下文（changelist/团队规范）+ 回写工作流 + Chat Tools 暴露。

**M5 启动前置**：`engines.vscode` 上调以支持 LM/Chat API；opt-in 配置开关；模型来源可切换。

## 6. 验证体系

- **单元测试（Vitest，< 1s）**：engine/ 纯逻辑（scm-mapping、changelist-grouper、commit-pipeline、conventional-linter、git-status-map、conventional-check）+ CommitService.executeCommit（mock Repository，7 分支）。共 45 项。
- **集成测试（@vscode/test-electron）**：扩展激活 + 全部命令注册（M1-M4）；真实 git 提交闭环（fixture 仓库 add+commit+git log 校验）；amend 改写 HEAD。共 3 项。
- **CI（GitHub Actions）**：lint→build→test 矩阵（ubuntu/mac/win + Linux xvfb）→package vsix→artifact；`tag v*` → 双市场发布（Marketplace + OpenVSX，需 secrets）。

## 7. 发布状态

- **当前版本**：0.0.5（首个 MVP 正式版，对外首发）。
- **首发历程**：经若干内部迭代与 `v0.0.1-rc.*` 预发布打磨后，以 `v0.0.5` 作为首个 MVP 正式版对外发布（package 版本 `0.0.5` + git tag `v0.0.5`）。Marketplace 仅支持 `major.minor.patch`，预发布语义由 `--pre-release` 标记 + tag 体现。
- **发布前置**：publisher 账号（`threefish-ai`）、VSCE_PAT / OVSX_PAT secrets、PNG 图标。
