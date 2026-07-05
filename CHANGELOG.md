# Changelog

本项目的所有重要变更均记录于此文件。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

> 面向用户的发布说明（含完整特性叙述与安装指引）见 [`docs/releases/`](./docs/releases/README.md)。

## [Unreleased]

## [0.0.13] - 2026-07-05 — 视图容器由活动栏迁移至底部面板（Terminal 之后）

将 Hyper Git 视图容器从活动栏（Activity Bar / Primary Side Bar）迁移至底部面板（Panel），默认排在 Terminal 页签之后，提供与官方 Terminal / Output / Problems 一致的底部停靠体验。完整用户视角叙述见 [Release Note v0.0.13](./docs/releases/v0.0.13.md)。

### Changed
- **视图容器 dock 迁移**：`package.json` 的 `viewsContainers` 由 `activitybar` 改为 `panel`，容器 id `hyper-git` 与全部 7 个视图（Commit / Graph / Branches / Stash / Shelf / Worktrees / changesBadge）不变；`.ts` 源码与图标无需改动（dock 类型与 views 归属、API 调用、图标规范完全解耦）。`initialSize` 语义随之由侧边栏高度权重变为 Panel 主轴权重，值本身不改。

### Known Limitations
- **活动栏「始终可见」未提交角标消失**：迁移后活动栏不再有 Hyper Git 入口图标，[issue #10](./docs/.agents/issue.md) 修复的「面板未打开也持续显示」活动栏计数角标随之失效；未提交计数仅在 Panel 展开时可见（VS Code 平台行为）。详见 [issue #13](./docs/.agents/issue.md)。
- **老用户需重置视图布局**：VS Code 会记忆旧的 activitybar 位置，升级后需命令面板执行「View: Reset View Locations」或右键容器页签「Reset Location」才采用新默认（[issue #12](./docs/.agents/issue.md) 同款平台行为）。

### Docs
- 新增 [Release Note v0.0.13](./docs/releases/v0.0.13.md)；[issue #13](./docs/.agents/issue.md) 记录 dock 迁移决策与 badge 权衡。

## [0.0.12] - 2026-07-04 — 提交详情光标跟随悬浮卡 · Tooltip 交互修复 · 布局优化 · 依赖升级基线

在 v0.0.11 基础上，将 Graph 提交详情悬浮卡重做为**随光标浮现、逐项对齐 VS Code 官方 Source Control GRAPH** 的形态（其间曾尝试迁移至右侧编辑器区面板，最终撤回、改回光标跟随浮层），并配套修复 CI / 提交两类 Tooltip 的定位、互斥、键盘触发与引用胶囊截断等一系列交互回归；同时优化侧边栏视图默认布局，并合入 TypeScript 6 / vitest 4 / vite 8 等依赖升级基线。完整用户视角叙述见 [Release Note v0.0.12](./docs/releases/v0.0.12.md)。

### Changed
- **Graph 提交详情改为「光标跟随 hover 悬浮卡」并逐项对齐官方**：撤销中途「提交详情迁移至右侧编辑器区 WebviewPanel」的方案，改为随光标浮现的 `#commit-tip` 悬浮卡（采用 `editorHoverWidget` 语义令牌、与 CI 状态浮层同款视觉语言）；内容逐项对齐官方 Source Control GRAPH——变更文件 diffstat、作者 / 提交者邮箱、作者 / 提交时间（绝对 + 相对）、所在 branches / tags / remotes 引用胶囊与 Committer 行。新增 engine 纯函数 [`format-time`](./src/engine/log/format-time.ts)（绝对 + 相对时间格式化）作单一事实源，并扩展 [`commit-files`](./src/engine/log/commit-files.ts) diffstat 解析与 [`protocol`](./src/shared/protocol.ts) 提交详情载荷。(#65, #69)
- **侧边栏视图默认布局优化**：Stash / Shelf 两个次要视图默认折叠（`visibility: "collapsed"`，仅占标题栏、点击即展开），Worktrees 保持默认展开、仅以 `initialSize` 收窄；并为各视图设置初始高度权重（`initialSize`：Commit / Graph 较高、Branches 居中、次要视图紧凑），缓解视图挤占空间的体感。注：VS Code 侧边栏视图存在约 142px 硬性最小展开高度（核心硬编码、官方特性请求 [microsoft/vscode#123715](https://github.com/microsoft/vscode/issues/123715) 已 not planned），**无法经扩展解除**；上述默认仅对**新安装**或执行「View: Reset View Locations」后的布局生效。详见 [issue #12](./docs/.agents/issue.md)。(#64)

### Fixed
- **CI 与提交详情 Tooltip 定位更贴近光标**：浮层与光标间距由 14 收窄至 8，并对纵向翻转做视口钳制，避免浮层超出可视区或与光标脱节。(#77)
- **CI 与提交详情 Tooltip 互斥 + 浮层内引用胶囊完整不截断**：两类浮层不再同时显现互相遮挡；提交悬浮卡内的 branches / tags / remotes 引用胶囊改为完整显示、不再被省略号截断。(#76)
- **CI 状态 Tooltip 键盘触发丢失**：`positionTip` 改为 rect / cursor 双模式定位，键盘（`i` 键）触发时以行 rect 锚定，恢复鼠标之外的可访问触发路径。(#74)
- **恢复提交 Tooltip 丢失的 branches / tags / remotes 胶囊与 Committer 行**：修复重做过程中的回归，提交悬浮卡重新完整呈现引用胶囊与（与作者不同时的）提交者行。(#74)

### Build
- **TypeScript `5.9` → `6.0.3` 升级并迁移 tsconfig 模块解析策略**。(#67)
- **测试与构建工具链升级**：`vitest 2` → `4.1.9`、新增显式 `vite ^8.1.3`、`typescript-eslint 8.39` → `8.62.1`，并重生锁文件。(#66)
- **其余开发依赖升级**：`@stylistic/eslint-plugin 2` → `5.10.0`、`@types/node 26.0.1` → `26.1.0`、`prettier 3.9.3` → `3.9.4`。(#55)
- **依赖治理**：`actions/checkout 4` → `7` (#54)，并将 dependabot `target-branch` 锚定至 `feature/1.x.x`、4 项依赖升级改道版本演进分支。(#75)

### Docs
- **文档口径同步为 VS Code Marketplace 单市场**：移除文档中残留的 OpenVSX 记述，与 v0.0.11 起的单市场发布决策对齐。(#63)

## [0.0.11] - 2026-07-04 — 首个正式版（承载 0.0.10 内容）· 发布渠道收敛 Marketplace

首个 VS Code Marketplace **正式发布**版本，承载 0.0.10 预发布通道（rc.1 / rc.2）已验证的全部内容——提交图更名 **Graph** 并对齐官方 Source Control GRAPH、悬浮浮层 iframe 裁剪修复、未提交角标承载迁移、README 真实性校准与中英双语；并将发布渠道收敛为 **VS Code Marketplace 单市场**。`0.0.10` 版位已被预发布通道占用，正式版按官方规则顺延至 `0.0.11`。完整用户视角叙述见 [Release Note v0.0.11](./docs/releases/v0.0.11.md)。

### Changed
- **发布渠道收敛为 VS Code Marketplace 单市场**：移除 CI `publish` job 的 OpenVSX 发布步骤及对 `OVSX_PAT` 的依赖，README 双语安装渠道同步移除 OpenVSX；发布流水线现为 **GitHub Release + VS Code Marketplace**（由 `ENABLE_MARKETPLACE_PUBLISH` 变量门控，`rc` 标签走预发布通道）。
- **Log 视图更名为 Graph 并对齐官方 Source Control GRAPH**：泳道连线改三次贝塞尔平滑曲线、HEAD 空心双环高亮、引用胶囊改全圆角实心 pill 并跟随泳道色、工具栏 seg 贴近官方；命令标题 / 视图名 / aria-label 统一为 Graph（内部标识符不动，不改数据 / 协议 / 布局算法 / CI 逻辑）。(#53)

### Fixed
- **提交 / CI 悬浮浮层被侧边栏 iframe 裁剪失效**：抽出共用 `positionFloat`（锚右侧 → 越界翻左 → 再越界收进视口）彻底修复。(#53)
- **活动栏未提交变更数角标更新不及时**：角标承载由 Commit `WebviewView` 迁至隐藏 Treeview（`hyperGit.changesBadge`，`when:false`），`activate` 即实例化、面板未打开也可靠；新增 engine 纯函数 `change-count` 作去重单一事实源。(#52)
- **发布流水线预发布打包缺陷**：`package` job 对 rc tag 补 `--pre-release` 打包，与 `vsce publish --pre-release` 对齐，修复 Marketplace 预发布 publish 失败。详见 [issue #11](./docs/.agents/issue.md)。

### Docs
- **README 真实性校准 + 中英双语重构**：单测计数校正为 324、移除不存在的 `ui/` 层描述、publisher 落实为 `ThreeFish-AI`；根英文、中文迁入 [`docs/i18n/zh-CN/README.md`](./docs/i18n/zh-CN/README.md)。(#51)

## [0.0.10-rc.2] - 2026-07-04 — 修复发布流水线预发布打包缺陷

rc.1 因 CI `package` job 未以 `--pre-release` 打包，致 `publish` job 的 Marketplace 步骤报「VSIX 未以 pre-release 打包」而失败（OpenVSX 步骤随之被 skipped），三渠道仅 GitHub Release 成功、Marketplace/OpenVSX 未发出。rc.2 修复该流水线缺陷后重新走通；产品内容与 rc.1 一致。完整叙述见 [Release Note v0.0.10-rc.2](./docs/releases/v0.0.10-rc.2.md)。

### Fixed
- **CI `package` job 对 rc tag 以 `--pre-release` 打包**：VS Code 要求「以预发布方式发布的 VSIX 必须在打包时即带 `--pre-release` 标记」，否则 `vsce publish --pre-release` 报 `Cannot use '--pre-release' flag with a package that was not packaged as pre-release`。`package` 步骤改为与 publish / OpenVSX 同款 `PRE_FLAG` 判定（`GITHUB_REF_NAME` 含 `rc` 即追加 `--pre-release`），令同一枚预发布 VSIX 贯穿 GitHub Release / Marketplace / OpenVSX 三渠道；正式版 tag 与分支 / PR CI 行为不变。详见 [issue #11](./docs/.agents/issue.md)。

## [0.0.10-rc.1] - 2026-07-04 — Graph 视图对齐官方 · 浮层与角标修复 · 发布链路验证

面向 0.0.10 的首个预发布（RC）。在 v0.0.9 基础上将提交图视图更名为 **Graph** 并视觉对齐 VS Code 官方 Source Control GRAPH 视图，修复提交/CI 悬浮浮层被侧边栏 iframe 裁剪失效、活动栏未提交数角标更新不及时两处缺陷，并完成 README 真实性校准与中英双语重构。本版亦作为 **VS Code Marketplace 发布链路打通**的验证版（首次以官方预发布模型 `--pre-release` 发布 `0.0.10`）。完整用户视角叙述见 [Release Note v0.0.10-rc.1](./docs/releases/v0.0.10-rc.1.md)。

### Changed
- **Log 视图更名为 Graph 并对齐官方 Source Control GRAPH**：泳道连线由直线改三次贝塞尔平滑曲线（同列自动退化直线）；当前 HEAD 行渲染为空心环 + 内点（双环高亮）；引用胶囊移至 message 右侧后缀、底色跟随本行泳道色、改全圆角实心 pill + 分支/云/tag 内联 SVG 图标前缀；工具栏 seg 按钮间距 / 圆角 / hover 态贴近官方。视图名与 Refresh / Filter / Clear Graph Filter 命令标题、CI 配置描述、aria-label 统一为 Graph（`viewType hyperGit.log`、`log/*` 消息前缀等内部标识符不动，不改底层数据 / 协议 / 布局算法 / CI 逻辑）。(#53)

### Fixed
- **提交 / CI 悬浮浮层被侧边栏 iframe 裁剪失效**：#48 的浮层定位将横向定位改为 `left = window.innerWidth + 8`，误以为 webview `position:fixed` 可越界渲染到编辑器；实则侧边栏 WebviewView 是沙箱 iframe，坐标系为自身视口，该值落到右边界外被裁剪不可见。抽出共用 `positionFloat`（锚触发元素右侧 → 越界翻左 → 再越界收进视口），彻底修复 CI 与提交两处浮层。(#53)
- **活动栏未提交变更数角标更新不及时**：角标原挂 Commit `WebviewView`，VS Code 在 `resolveWebviewView`（用户打开过面板）前无法显示 webview 角标（vscode#164974 / #146330），致面板未打开时新变更不点亮、提交 / 撤销后不清除。改由隐藏 TreeView（`hyperGit.changesBadge`，`when:false`）承载，`activate` 即实例化、无论面板是否打开都可靠聚合到容器图标；新增 engine 纯函数 [`change-count`](./src/engine/scm-mapping/change-count.ts)（`toRelKey` / `countUniqueChanges`）与 `GitRepositoryService.getChangeCount()` 作单一事实源（`getChanges` 复用同一去重逻辑），角标走独立 40ms 微防抖快路径、与 150ms 重刷新解耦；移除 Commit webview 死代码（`updateBadge` / `pendingBadge`）杜绝容器 2× 计数，并补 change-count 单元测试锁定计数不变式。(#52)

### Docs
- **README 真实性校准 + 中英双语重构**：经 3 路只读核验 + 单测实跑取证修正——移除不存在的 `ui/` 层（改述 `engine/` → `adapter/`）、单元测试计数 280 → **324**、行级提交 CodeLens 标签校准为 "Commit this Hunk"、publisher 占位符落实为真实 `ThreeFish-AI`；根 `README.md` 改写为地道英文版，中文版迁入 [`docs/i18n/zh-CN/README.md`](./docs/i18n/zh-CN/README.md) 并互加语言切换、补入 CHANGELOG 链接。同步校正文档中心「最新」发布指针与知识索引 agent 接缝清单。(#51)
- 补充 `vsce` 发布用法说明并重构 README 底部 footer，修复链接渲染与协议措辞。

> 规模实证（README 校准后）：**6 视图 / 97 命令 / 6 配置项 / 324 单元测试**（32 文件全绿）+ 集成测试，CI 三平台（Ubuntu / macOS / Windows）矩阵全程 GREEN。

## [0.0.9] - 2026-07-04 — 视图整合 · UI 系统化 · 分支与 CI 增强

自上一个正式版 0.0.6 以来的首个公开版本，聚合 0.0.7 / 0.0.8 / 0.0.9 三轮迭代：提交/日志视图内聚重构、UI/UX 全局系统化、分支与 CI 能力增强，以及一批工程修复。完整用户视角叙述见 [Release Note v0.0.9](./docs/releases/v0.0.9.md)。

### Added
- **变更文件目录树切换**：Commit 视图活动 Changelist 文件列表、Log 视图选中提交的变更文件列表均支持「平铺 / 按目录分组（Group by Directory）」两态切换（工具栏 List/Tree 段控），偏好按视图 `webview.setState` 记忆。目录树由纯逻辑 [`engine/tree/file-tree.buildFileTree`](./src/engine/tree/file-tree.ts) host 侧构建随 payload 下发（复用 graph-layout「host 算、webview 渲」范式，规避内联脚本无法 import engine 的 Split-Brain），叶子以 `fileIndex` 回指扁平列表；支持单目录子链折叠（对齐 VS Code `explorer.compactFolders`）；Commit 树形附目录级三态复选框。详见 [变更文件目录树](./docs/features/file-list-group-by-directory.md)。(#47)
- **Log 提交悬浮详情**：鼠标悬停 Log 提交行以浮层展示完整信息——所在本地/远程分支、标签、HEAD、完整提交消息（subject + body）、作者 `name <email>`、（与作者不同时）提交者、作者/提交时间（绝对 + 相对）、完整 SHA；复用 CI 状态浮层范式（置于虚拟滚动容器外、与 CI 浮层互斥），`i` 键开、`Esc` 关，滚动/刷新自动消隐。`git log` 取数扩展 `%cn/%cI/%b`（body 置末，NUL/RS 分隔容多行），正文上限截断以控 payload。详见 [Log 提交悬浮详情](./docs/features/log-commit-tooltip.md)。(#47)
- **清理已删远程分支入口**：Branches 视图新增「Clean up Deleted Remote Branches」命令，一键剔除远端已删除却仍残留于本地的 remote-tracking 引用，根治 Log 视图残留已删分支提交的游离泳道。(#44)
- **远程分支右键删除**：Branches 视图远程分支支持右键删除（`git push --delete <remote> <branch>`），无需切到命令行。(#42)

### Changed
- **Commit 视图承接全部变更管理能力**（原 Changes 视图平移）：活动 Changelist 文件单击看 Diff、右键（原生 QuickPick）执行 移动到 Changelist / 查看历史 / 暂存·撤销 Hunks / 加入 `.gitignore` / 丢弃改动；头部提供 Changelist 切换下拉 + ⋯ 管理菜单（新建 / 重命名 / 删除）。详见 [Commit 视图整合](./docs/features/commit-view-consolidation.md)。(#47)
- **Git 操作工具栏与未提交数角标迁至 Commit 视图**：原挂在 Changes 视图标题栏的 refresh / push / pull / fetch / patch 等动作迁到 Commit 视图标题栏（去掉与 webview 内按钮重复的 commit / commitAndPush）；活动栏未提交数角标改由 Commit `WebviewView.badge` 承载，首帧未 resolve 以 `pendingBadge` 兜底。(#47)
- **UI/UX 全局系统化**：建立共享设计 Token 地基（spacing / radius / button，`shared-styles.ts`）并注入 Commit / Log / Merge / Rebase 四个 Webview；Log DAG 泳道色改读 `--vscode-charts-*` 主题令牌（深浅主题自适应）；命令层去冗余（标题栏 ≤5 项、同步操作下沉溢出组、危险操作归入 `9_dangerous`、新增 `hyperGit.logFilter` 聚合过滤器）；~94 项命令标题 / 配置 / viewsWelcome 统一英文并为高频与危险命令补齐 codicon；Webview 加固（空态、加载态、快捷键、ARIA）与 5 棵 TreeView 的 Markdown Tooltip 统一。(#43)
- **品牌图标改用透明底 Emerald 绿环方案**：源图标改为透明底 + `#3FB950` 绿色圆环 + git-pull-request 字形，重生成 256×256 透明 PNG（66KB→14KB）；新增 `galleryBanner`（`#0E2A1C` 深绿、dark 主题）与 Marketplace 页头协调。(#49)

### Removed
- **移除 CHANGES 树视图**：其展示的活动 Changelist 与 Commit 视图的 Active Changelist 完全重复（同源 `getChanges()` + `getGroups()`）；全部独有能力已零回归平移入 Commit 视图（见 Changed），视图数由 7 降为 6。(#47)

### Fixed
- **Log 提交/CI 浮层定位重做**：原 `positionTip`/`positionCommitTip` 把浮层锚定在所悬元素左沿并按 webview 宽度夹紧，420px 宽的浮层在 ~240px 窄侧边栏中从左沿一路铺到编辑器，既「撑满 LOG 视图」又方位怪异。改为横向固定到 `window.innerWidth + 8`（侧边栏右沿外、编辑器区内），纵向与所悬行/图标顶部对齐并按视口高度夹紧；复用 webview `position:fixed` 可越界渲染到编辑器区的特性，浮层不再压住 LOG 列表，自然悬浮于所悬行的右侧。(#48)
- **Log All 范围改用 `--branches --tags --remotes`**：原 `--all` 遍历全部 refs，含宿主工具注入的 `refs/conductor-checkpoints/*` 与 `refs/conductor-archive-heads/*`，致游离提交仍可达、被画成游离泳道；改用三大标准命名空间根治污染（Checkpointer 页保留 `--all` 以见原始完整图）。(#45)
- **CI 状态图标防闪烁与准实时刷新**：终态缓存避免重复请求以消除闪烁，轮询间隔优化实现准实时刷新，各检查项状态图标与 Tooltip 颜色按通过 / 失败 / 运行中语义对齐。(#41, #40)
- 修复 `vsce package` 打包因 ESLint `no-useless-assignment` 阻断：`engine/ci/remote-parser.ts` 中 `host`/`path` 的空串初值为 dead store（`hasScheme` 真假两分支均无条件重赋、解析失败处先 `return null`），改为带类型标注的纯声明消除，由 TS 确定赋值分析接管，运行时行为不变。
- 修复 Log 提交悬浮浮层「行→浮层→空白」后卡死不消失：`commitTipEl.mouseleave` 未复位 `overCtRow`，致 `scheduleHideCommit` 的 `!overCtRow && !overCt` 守卫恒不成立；在 `mouseleave` 一并复位 `overCtRow` 修复。
- 修复 `capBody` 截断劈开 Unicode 代理对：`String.prototype.slice(0, BODY_CAP)` 按 UTF-16 码元计数，2000 边界落在 emoji 代理对中间会留下孤立高代理位（渲染为 `�`）；改用 `Array.from(t).slice(0, BODY_CAP).join('')` 按码点截断。

## [0.0.6] - 2026-06-30 — 首个 MVP 正式版

首个对外正式版本，在 VS Code Marketplace / OpenVSX 上以 **「Hyper Git - Agentic Git」** 之名发布。为 VS Code 提供统一的 Git 变更管理与提交工作流（多变更分组、自绘提交面板、可视化提交图、Shelf、行级提交）。采用**路径 B**（消费 `vscode.git` 稳定 `Repository` API 为底座；稳定 API 未覆盖的能力经 `GitRepositoryService.execGit` 复用同一 git 二进制 `api.git.path` 的受控 CLI 通道实现），与原生 Source Control 平行共存、零冲突。规模：**7 视图 / 93 命令 / 6 配置项**，**280 单元测试** + 集成测试，CI 三平台矩阵全程 GREEN。完整特性见 [Release Note v0.0.6](./docs/releases/v0.0.6.md)。

### Added

#### 变更与 Changelist
- 按 Changelist 分组的 Changes 树视图：新建 / 重命名 / 删除 / 设活动列表 / 跨列表移动文件，`workspaceState` 持久化（重启恢复）；文件状态色复用 `gitDecoration.*` 主题色；单击打开原生 Diff（HEAD ↔ Working）。
- 文件级操作：丢弃改动、加入 `.gitignore`、显示文件历史。

#### Commit 提交窗口
- 自绘提交面板（WebviewView）：活动 Changelist 文件勾选 + 多行消息编辑器 + Amend / Signed-off-by / 跳过 Git Hooks + **提交** / **提交并推送**；勾选集即提交权威范围（仅提交选中的文件集合）；最近消息一键复用。
- Conventional Commits 实时校验（可配置）+ 内置 `ConventionalCommitCheck` Checkin Hook；`CommitPipeline` 责任链设计参考 JetBrains `CheckinHandler`（校验 → 暂存 → Hook 链 → 提交 → 可选推送）。

#### Log 提交图与历史
- 自绘 **Graph DAG** webview：基于父子关系自计算 lane 布局，彩色泳道 / 节点 / 分叉·合并连线 / HEAD·分支·标签徽标，`--topo-order` 保拓扑序，行宽随实际 lane 自适应；虚拟化滚动增量加载、↑↓ 键导航；选中提交内联展开变更文件并打开单文件 Diff。
- **提交图 × CI 状态**：每条提交行最右侧显示 GitHub CI 最终状态（绿勾/红叉/运行中），悬停 Tooltip 展示各项检查 + 未通过原因 + 跳转链接；复用 VS Code 内置 GitHub 认证（`vscode.authentication`，凭证不经 chat/日志/webview），仅取可见行懒加载、批量 GraphQL（≤100 oid）+ 限流冷却、终态缓存；非 GitHub 远程零图标零请求，支持 github.com 与 GitHub Enterprise；配置 `hyperGit.log.ci.{enabled,remote,provider}`。
- **Checkpointer 过滤**：Log 视图新增 Checkpointer 选项，默认剔除 AI 编码工具产生的自动快照（checkpoint）提交，提交图更干净，可按需开启。
- **7 个可组合过滤器**：作者、路径、message（grep）、message（正则）、合并模式、日期、一键清除；复制 commit hash、刷新。
- per-commit 操作：Reset 到此（soft/mixed/hard/keep）、从此新建分支 / 标签、查看包含此提交的分支、Cherry-Pick、Revert。

#### Branches 与 Tags
- 四段分组（收藏 / 本地 / 远程 / 标签）+ ahead·behind·upstream 跟踪展示；新建 / 检出 / 删除 / 重命名 / 合并 / 变基 / 从选中新建并检出；收藏切换、与当前分支比较、任意两分支比较、复制引用、清理已合并分支。
- **多选批量操作**：`createTreeView({ canSelectMany: true })` 支持框选，批量删除分支/标签、批量复制引用、批量收藏；删除前 `git branch --merged` 分类已合并/未合并并诚实分栏确认强制删除风险；仅单目标语义的操作经 `!listMultiSelection` 在多选时隐藏。
- 标签：新建（轻量/附注）、删除（多选）、检出（detached HEAD）。

#### Stash 与 Shelf
- Stash：创建、保留已暂存创建、应用、Pop、删除、从 Stash 创建分支、清空全部，按真实 `stash@{n}` 索引操作。
- Shelf（基于 patch、独立于 git stash 的改动搁置机制）：Shelve 暂存、静默 Unshelve、带 3-way 合并 Unshelve、删除；独立 TreeView。

#### 远程与冲突
- Pull / Push / Fetch（无上游分支自动选定 remote 并建立 `-u` 跟踪；`GitError.stderr` 优先暴露使失败可读）。
- 对话框：**Push…**（normal / force-with-lease / force + 推送标签）、**Update Project…**（merge / rebase）、**Merge…**（ff-only / no-ff / squash + 自定义消息）。
- 冲突兜底引导：merge/rebase/pull/cherry-pick/revert/stash-pop/unshelve 失败时检测冲突并弹「解决/中止」；自绘 **3-way Merge Editor**（OURS / RESULT 可编辑 / THEIRS + 写回 `git add`）；冲突文件「采用 Ours / Theirs」。

#### 历史编辑与高级操作
- Cherry-Pick、Revert、Reset HEAD（soft/mixed/hard/keep）、交互式 Rebase（webview：pick/squash/fixup/drop + reword + 拖拽重排，经 `GIT_SEQUENCE_EDITOR` 非交互写入）、撤销最近提交（soft）、删除提交（rebase）、Fixup（autosquash）、改写最新提交信息。

#### 编辑器内能力
- 行内提交：每个未暂存 Hunk 上方渲染 CodeLens「提交此 Hunk」→ patch 重建 + `git apply --cached` 仅暂存该 Hunk → 提交（含他处已暂存内容的二次确认）。
- 部分暂存 / 取消暂存、光标处暂存、Hunk 归属 Changelist（持久化 hunk→CL 映射）。
- Blame 行内注解：逐行作者 / 日期 / hash 显示于编辑器内，悬浮展示提交详情，文档编辑时自动清除。

#### Worktrees
- 全生命周期管理：新建（新分支 / 检出已有 / detached）、在新窗口打开、锁定 / 解锁、移动、复制路径、删除（安全 / 强制）、清理失效 Worktree、刷新。

#### 工具与配置
- 导出 / 应用 Patch、查看 Reflog、3-way Diff 概览（HEAD ↔ Staged ↔ Working）、Console 命令输出面板。
- 配置项：`hyperGit.commit.template`、`hyperGit.commit.conventional`、`hyperGit.ai.enabled`（M5 预留，暂不生效）、`hyperGit.log.ci.{enabled,remote,provider}`（提交图 CI 状态）。

#### 架构与质量
- 正交分层：`engine/`（纯逻辑，零 vscode 依赖、Vitest 可测）、`adapter/`（唯一接触 vscode API）、`agent/`（AI 接缝）、`ui/`、`shared/protocol.ts`（Webview ↔ Host 契约单一事实源）、`infra/`。
- AI 接缝预埋 5 接口 + Null 实现（`ILlmProvider` / `ICommitMessageProvider` / `IPreCommitInspector` / `IChangelistGrouper` / `IConflictResolver`），设计参考 JetBrains `CheckinHandler` 提交生命周期，M5 替换为真实实现。
- 品牌图标统一为「Git Pull Request」造型（活动栏 SVG + Marketplace 徽标 + README 头图，字形改编自 Tabler Icons，MIT）；活动栏图标实时显示未提交文件数角标。
- CI 流水线：lint → 类型 → 构建 → 三平台测试矩阵（Ubuntu/macOS/Windows，Linux 经 xvfb）→ 打包 vsix；`v*` 标签触发 GitHub Release（附带可本地安装的 `.vsix`，正文取自 `docs/releases/`）+ OpenVSX 发布；VS Code Marketplace 由 `ENABLE_MARKETPLACE_PUBLISH` 变量门控。

### 已知限制

- Commit 窗口的 Co-authored-by / Author 覆盖（`--author`）/ 撤销最近提交按钮 UI 接线（engine `trailer` 已就绪，仅缺 webview 交互）。
- Partial 多文件选择 UX、行级 split chunks（按选定行拆分提交）。
- 目录 / folder diff（虚拟文档）、Submodules 管理。
- M5 AI Agent（5 个接缝已预埋 Null 实现，本版未启动）。

[0.0.9]: https://github.com/ThreeFish-AI/hyper-git/releases/tag/v0.0.9
[0.0.6]: https://github.com/ThreeFish-AI/hyper-git/releases/tag/v0.0.6
