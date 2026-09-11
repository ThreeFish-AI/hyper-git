# Log 提交详情面板（Commit Detail Panel）

> 点击 Log 视图任一提交行，在**图右侧**于 webview 内水平分栏打开常驻详情面板：上半区 **Changed Files**（List ⇄ Tree 切换、点击打开 Diff），下半区**提交信息**——作者（`name <email>`）+ 时间（绝对 + 相对）、**HEAD / 本地分支 / 远程分支 / 标签**引用分组、完整消息（subject + body）、（与作者不同时的）提交者、变更统计、完整 SHA、Open on GitHub。**面板可见性 ⟺ 选中态**：`×` 或 `Esc` 取消选中即收起，**再次点击已选中的提交行同样取反收起**（300ms 内的双击第二击豁免）。**三区两根 gutter 可拖拽**：图 ⇄ 面板、上半区 ⇄ 下半区的宽高比例随拖实时调整、按仓库记忆。原悬停浮层（`#commit-tip`）与 `i` 快捷键整体移除；原 webview 工具栏（scope 段控 / 仓库名 / CI 登录）整体上移 VS Code 标题栏，仓库路径改由 `WebviewView.description` 呈现，省一整行竖直空间。

## 布局与定位

VS Code 的 panel 视图容器（`hyper-git`）内多视图只能**垂直堆叠**，无法原生并排两个子视图；编辑器区 `WebviewPanel` 方案亦曾实验后回退。故「右侧平级视窗」落地为 **Graph webview 内部左右分栏**（对齐 Git Graph 扩展的 Details 列形态）。视图级控件全部上移 VS Code 原生标题栏（`view/title` 贡献点）：

| 控件 | 形态 | 事实源 / 显隐 |
|---|---|---|
| Scope（All / Current / Checkpoints） | `$(layers)` 图标下拉子菜单，`toggled` 勾选当前项，默认 All | host `workspaceState`（`hyperGit.log.scope:<repo>`）+ `hyperGit.log.scope` context key |
| Changed Files List ⇄ Tree | `$(list-tree)` / `$(list-flat)` 互斥图标（同 Branches 分组切换范式） | host `workspaceState`（`hyperGit.log.dmode:<repo>`）+ `hyperGit.log.tree` |
| 切换仓库（多仓库态） | `$(repo)` 图标按钮 | `hyperGit.log.multiRepo` |
| 登录 GitHub（CI） | `$(sign-in)` 图标按钮，授权完成自动隐藏 | `hyperGit.log.ciNeedsSignIn` |
| 仓库路径 | `WebviewView.description` 副标题（标题「Graph」右侧常驻） | `pushState` 时随 `repoRoot` 更新 |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/architecture/features/log-commit-detail-panel-layout.dark.svg">
  <img src="../assets/architecture/features/log-commit-detail-panel-layout.light.svg" alt="Commit 详情面板布局（Graph webview 内部左右分栏）">
</picture>

> [交互版](../assets/architecture/features/log-commit-detail-panel-layout.html) · [Mermaid 源图](../assets/mermaid/features/log-commit-detail-panel-layout.mmd)（图资产溯源见 [图资产索引](../assets/mermaid/README.md)）

gutter 交互：`pointerdown` 捕获指针 → `pointermove` 实时更新 flex-basis → `pointerup` 持久化（`panelPct`/`detailPct` 随选中/目录折叠一起按仓库入 webview state）；`role="separator"` + `tabindex` 键盘可达（方向键 ±2%、Home/End 归边界），`.dragging`/`:hover` 高亮分隔线。

- **可见性不变式**：`#commit-panel.show` ⟺ `selectedHash !== null`。所有路径经三个漏斗收敛——`requestPanelData(hash)`（开面板 + Loading）、`deselectRow()`（收面板 + 清选中 + 焦点回落图区）、`log/graphData` 的恢复/消失分支。`deselectRow()` 的幂等守卫**同时校验选中态与面板可见性**：`graphData` 解析出「无选中」（如切到无记忆选中的仓库）时 `selectedHash` 本已为 `null`，仅按选中态早退会把上一仓库的面板连内容一起留在原地。
- **窄视口降级**：面板 `min-width: 280px` 不可收缩，横向并排会把 `#viewport` 挤至零宽（`flex: 1` + `min-width: 0`）。故 `#main` 宽度 < 560px 时切 `.stacked` 退化为上下堆叠（面板 45%，图区保 55%）——观察 `#main` 而非 `#viewport`，因后者宽度随面板开合变化会形成「开面板→变窄→堆叠→变宽」反馈环。面板开合引起的 `#viewport` 宽度变化仍由既有 `ResizeObserver` 切 `.narrow`（隐 author/date、留 CI 列）。

## 交互与数据流

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/architecture/features/log-commit-detail-panel-dataflow.dark.svg">
  <img src="../assets/architecture/features/log-commit-detail-panel-dataflow.light.svg" alt="Commit 详情面板数据流（选中 → 取数 → 渲染）">
</picture>

> [交互版](../assets/architecture/features/log-commit-detail-panel-dataflow.html) · [Mermaid 源图](../assets/mermaid/features/log-commit-detail-panel-dataflow.mmd)（图资产溯源见 [图资产索引](../assets/mermaid/README.md)）

- **一次选中、两路并行**：host `log/selectCommit` 分支同时发起变更文件与详情取数，均沿用 `rootAtStart` 切库竞态守卫（issue #107）。
- **过期回包丢弃**：`log/commitFiles` 按 `hash`、`log/commitDetail` 按 **`forHash`** 回显校验——失败回包 `vm=null` 无 hash 可比对，`forHash` 补齐该盲区，杜绝迟到失败在新选中下闪现占位。
- **失败非静默**：详情取数失败显示 "Details unavailable" 占位；同 hash 重点击放行重试（`metaFailHash` 例外）。
- **同 hash 重点击取反**：点击已选中的提交行 = 反向操作收起面板（方向键/Home/End 边界仍走防抖早退，不误触）；距选中 <300ms 的第二击视为双击成分、豁免取反（双击=「打开」语义保留，无开合抖动）；取数失败态（`metaFailHash`）例外放行重试。
- **刷新语义**：提交对象不可变——文件不重拉；`meta` 按新行集重渲（新推分支/标签等引用 chips 变化即时反映）。
- **重载恢复**：选中 hash 本就按仓库持久化（state v2），`graphData` 到达且选中行存在时补拉面板数据，实现跨重载/切库恢复。
- **XSS 安全**：分支名/标签/作者/正文等一切外部内容均经 `esc()` 转义后注入。
- **标题栏切换通路**：scope 切换 → host `setScope`（memento + context key + 防抖重拉）；List/Tree 切换 → host `setDetailMode`（`log/detailMode` 定向下发，免整图重拉）；两者均为 host 侧事实源，随 `graphData`（`scope`/`dmode` 字段）在重载/切库后恢复。

## 边缘 Case

| Case | 行为 |
|---|---|
| 快速连点 A→B→C | 每击即显新 hash Loading；过期回包按 `hash`/`forHash` 丢弃 |
| 取数途中切库 | host 竞态守卫 + `forHash` 丢弃；新库 `graphData` 恢复其记忆选中 |
| 选中期间 git 刷新 | 面板保持，文件不重拉，引用分组按新行集重渲 |
| 根提交 / merge | "No changed files (may be a root or merge commit)" 占位 + 详情正常 |
| CI 图标 | 点击不选行、CI 浮层原样（原互斥代码随浮层一并消失） |
| 非 GitHub 远程 | 无 Open on GitHub 链接（host 不下发 `githubUrl`） |
| 键盘 | 方向键/Home/End 移动选中即更新面板；`Enter` 菜单、右键菜单原样；`Esc` 取消选中；gutter 聚焦后方向键 ±2%、Home/End 归边界 |
| 再次点击已选中行 | 反向操作收起面板；双击（<300ms 第二击）豁免；取数失败态重点击 = 重试 |
| 切到无记忆选中的仓库 | 面板收起并清空（不残留上一仓库的文件列表 / 详情，杜绝旧 hash 误发 `log/openFile`） |
| 视图窄于 560px | `.stacked` 上下堆叠，图区恒占满宽、不被面板压缩；`≥560px` 恢复左右分栏 |
| gutter 极限拖拽 | 横向钳制：面板 ≥200px 且图区 ≥280px；纵向钳制 18%–75% / 上半区 15%–85%，比例按仓库记忆 |
| 切库后拖拽比例 | `loadPersistedFor` 重装载该仓库记忆的 `panelPct`/`detailPct`（选中/目录折叠同批） |

## 实现

- 面板与漏斗：[`adapter/webview/log-webview.ts`](../../src/adapter/webview/log-webview.ts)（`#main`/`#commit-panel` 分栏、`selectRow`/`requestPanelData`/`deselectRow`、`renderCommitMeta`、Loading 占位、消息守卫、gutter 拖拽/键盘、再次点击取反与 300ms 双击守卫）。
- 标题栏控件：[`package.json`](../../package.json)（`view/title` 贡献：`hyperGit.log.scopeMenu` 子菜单 + `toggled` 勾选、`detailTree/detailFlat` 互斥图标、`selectRepository`/`ci.signIn` 条件按钮）+ host `setScope`/`setDetailMode`（memento + context key）；命令注册见 [`extension.ts`](../../src/extension.ts)。
- 协议：[`shared/protocol.ts`](../../src/shared/protocol.ts)（`log/commitDetail` 增 `forHash`、`LogGraphState` 增 `dmode`、新增 `log/detailMode`；移除 `log/showCommitDetail`、`log/setScope`、`log/selectRepo`、`log/ciSignIn` 与编辑器区面板遗留死类型）。
- 复用：[`engine/tree/file-tree.ts`](../../src/engine/tree/file-tree.ts)（目录树）、[`engine/log/commit-files.ts`](../../src/engine/log/commit-files.ts)（name-status 解析）、[`engine/ci/remote-parser.ts`](../../src/engine/ci/remote-parser.ts)（GitHub URL）、`log/openFile` → `hyperGit.openCommitFileDiff` Diff 链路不变。

## 验证

`pnpm run check-types` + `pnpm run lint` + `pnpm run test:unit`（403 用例）全绿；Extension Development Host（F5）：标题栏 Scope 下拉勾选切换、List/Tree 图标切换（免整图重拉）、仓库切换/CI 登录按钮条件显隐、description 路径常驻；点击行开面板（Loading → 文件计数 + 详情）、**再次点击取反收起、双击不抖动**、`×`/`Esc` 收起且方向键仍可用、gutter 鼠标拖拽/键盘微调、快速连点终态正确、选中态下 commit 后面板保持且 chips 更新、切分支选中消失自动收起、切库/重载恢复（含拖拽比例）、根/merge 占位、窄视图堆叠自适应。

分栏与状态机另经**离屏夹具实测**（抽取本文件真实 CSS + webview 脚本、桩掉 `acquireVsCodeApi` 后在浏览器中量测）：

| 视图宽度 | 降级前图区宽 | 降级后 |
|---|---|---|
| 1200px | 696px | 左右分栏，图区 696px |
| 640px | 360px | 左右分栏，图区 360px |
| 560px | 280px | 左右分栏，图区 280px（阈值边界） |
| 480px | 200px | `.stacked`，图区 480px |
| 320px | 40px | `.stacked`，图区 320px |
| 280px | **0px** | `.stacked`，图区 280px |

状态机六步序列（repo1 选中 → 切 repo2 无记忆选中 → 迟到 `vm=null` 回包 → 切回 repo1 → `×` 取消 → 重复取消）全部命中预期：面板可见性与 `selectedHash` 始终同步，重复 `deselectRow()` 零额外 `postMessage`，横向无溢出（`scrollWidth - clientWidth === 0`）。本轮标题栏迁移 + gutter + 取反交互复验：工具栏 DOM 零残留；真实鼠标拖拽主 gutter 150px → 面板 462→614px、图区 634→482px、`panelPct=0.5582` 入库；meta gutter 拖拽 80px → 上半区 275→357px、`detailPct=0.714`；极限拖拽钳制面板 200px / 图区 280px；键盘 ±2% 生效；堆叠态（420px）拖拽双向生效且图区恒满宽；`log/detailMode` 与 `graphData.dmode` 均正确驱动 Tree 渲染；webview 持久化键收敛为 `selectedHash/dcollapsed/panelPct/detailPct`。

## 展望

- 分栏比例持久化迁移至 host `workspaceState`（现随 webview state 按仓库记忆，与 scope/dmode 的宿主对齐；低优先）。
- 详情区随 `host` 防抖合并（方向键连续导航时减少单提交 `git` 调用，现为每停 2 次，毫秒级可接受）。
