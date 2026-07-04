# Commit 视图整合（移除 CHANGES，能力全量平移）

> CHANGES 树视图与 Commit 视图顶部的「Active Changelist」展示同一份数据（同源 `service.getChanges()` + `registry.getGroups()`），属冗余。现移除 CHANGES 视图，其**全部独有能力零回归**平移入 Commit 视图，侧边栏视图数由 7 降为 6。

## 平移清单（零功能回归）

| 原 CHANGES 能力 | 迁入 Commit 视图后的形态 |
|---|---|
| 文件单击看 Diff | 文件行单击（勾选框除外）→ `commit/openFile` → 复用 `hyperGit.openDiff` |
| 单文件右键菜单 | 文件行右键 → `commit/fileMenu` → 原生 `showQuickPick`：Open Diff / Move to Changelist… / Show History / Stage·Unstage Hunks… / Add to .gitignore / Discard Changes（复用既有命令，含 discard 确认框） |
| Changelist 管理 | 头部 `<select>` 切换活动列表（`commit/setActive`）+ `⋯` 菜单（`commit/changelistMenu` → 新建 / 重命名 / 删除） |
| Git 操作工具栏 | 标题栏（`view/title`）承接 refresh / push / pull / fetch / pushDialog / updateProject / createPatch / applyPatch；去掉与 webview 内 Commit·Commit&Push 按钮重复的两项 |
| 活动栏未提交数角标 | 迁至 Commit `WebviewView.badge`（容器图标角标 = 各视图 badge 之和，总数不变） |

## 关键设计（复用与最小回归）

- **右键菜单复用 Log 范式**：沿用 Log 视图「webview 右键 → `postMessage` → host `showQuickPick` → 复用既有命令」模式（`log-webview.handleCommitMenu`），键盘可达、无 CSP/焦点陷阱、零 in-DOM 浮层成本。
- **命令实参统一**：文件级命令改为接受 `ChangeItem | 路径字符串`，host 经 `resolveChange` 回落 `service.getChanges()` 解析（[`adapter/commands.ts`](../../src/adapter/commands.ts)，单一事实源）；`showHistory`/`ignorePath`/`partialStage`/`partialUnstage` 本就支持可选 `ChangeItem`，webview 直接传完整对象，故三处命令文件零改。
- **视图刷新**：删除 `tree.refresh()` 后，changelist/文件变更经 `registry.onDidChange` / `service.onDidChange` → `extension.refreshAll` → `commitView.refresh()` 驱动（原刷新链的自然替代）。
- **角标时序**：`WebviewView.badge` 仅在 `resolveWebviewView` 后可置，`CommitWebviewProvider.updateBadge` 在 view 未 resolve 时以 `pendingBadge` 暂存，resolve 后回填（见 [issue.md #8](../.agents/issue.md) 后续防范）。
- **命令面板**：迁移前这些命令即 `commandPalette: when:false`（唯一入口是 CHANGES 树），迁入后由 Commit webview 菜单承接，保持 webview-only，无面板暴露、无回归。

## 交互范围取舍

Commit 视图文件区以**活动 Changelist** 为提交目标（勾选集即提交范围）；非活动 Changelist 通过头部下拉切换查看。相较旧树「同屏并列多 changelist」少了一处低频便利，换取窄侧栏下更聚焦的提交工作流。

## 实现

- 视图与菜单：[`package.json`](../../package.json)（删 `hyperGit.changes` 视图 / viewsWelcome / 全部 `view == hyperGit.changes` 菜单；`view/title` 迁至 `view == hyperGit.commit`）。
- 视图主体：[`adapter/webview/commit-webview.ts`](../../src/adapter/webview/commit-webview.ts)（groups/switcher/文件交互/菜单/角标/目录树）。
- 命令：[`adapter/commands.ts`](../../src/adapter/commands.ts)（`resolveChange` + 签名重构）。
- 装配：[`extension.ts`](../../src/extension.ts)（移除 tree/changesView，角标改由 `commitView.updateBadge`）。
- 协议：[`shared/protocol.ts`](../../src/shared/protocol.ts)（`CommitChangelistItem`、`commit/openFile|fileMenu|setActive|changelistMenu`）。

## 验证

`pnpm run check-types && pnpm run lint && pnpm run test:unit` 全绿；Extension Development Host（F5）：无 CHANGES 视图；Commit 顶部可切换/管理 changelist；文件单击开 Diff、右键出菜单（含 discard 确认）；标题栏 Git 动作可用；活动栏角标随未提交数增减；无 Git 仓库时降级不崩溃。
