# Issues 摘要

> 用于跨上下文留存问题处理经验，避免重复踩坑。新条目追加在末尾，同 Issue 只维护一处。
>
> 每条摘要包含：**表因 / 根因 / 处理方式 / 后续防范 / 同类问题影响**。

---

## #1 JSDoc 块注释中的 `*/` 提前闭合注释

- **表因**：`pnpm run check-types` 在 `src/engine/model/index.ts` 报大量 `TS1127 Invalid character` / `TS1109 Expression expected`，指向一段纯中文注释行。
- **根因**：注释文本「`INDEX_*/工作区/冲突`」中的 `*/` 序列被 TypeScript 解析为块注释终止符，导致其后中文文本暴露为代码，触发语法错误。
- **处理方式**：改写注释，移除 `*/` 序列（`INDEX_*/工作区` → `INDEX 系列、工作区`）。
- **后续防范**：在任何 `/* ... */` 块注释内引用含 `*/` 的内容（如 `gitDecoration.*`、正则 `*/`、glob）时，必须转义或改写；可用 `grep -rn '\*/' src/ | grep -vE '\*/\s*$'` 扫描提前闭合。
- **同类问题影响**：所有含中文技术注释的 TS 文件，尤以注释内出现路径/枚举/正则片段时高发。

## #2 pnpm 11 构建脚本审批与配置迁移

- **表因**：`pnpm install` 输出 `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild, @vscode/vsce-sign, keytar`，导致 esbuild 原生二进制未安装，后续构建可能失败；且 `package.json` 的 `pnpm.onlyBuiltDependencies` 字段被忽略并告警。
- **根因**：pnpm 10/11 出于供应链安全默认拦截依赖 postinstall；同时 pnpm 11.9 将 `onlyBuiltDependencies` 等设置**移出 package.json**，新位置为 `pnpm-workspace.yaml`（本版本使用 `allowBuilds:` 审批格式，由 pnpm 自动生成脚手架）。
- **处理方式**：删除 package.json 的 `pnpm` 字段；在 `pnpm-workspace.yaml` 写入 `allowBuilds: { esbuild: true, '@vscode/vsce-sign': true, keytar: true }` 后重新 `pnpm install`，三个 postinstall 正常执行。
- **后续防范**：pnpm 项目一律在 `pnpm-workspace.yaml` 管理构建脚本审批；新增含原生二进制的依赖时，需在此文件追加放行；CI 首次 `pnpm install` 后确认无 `ERR_PNPM_IGNORED_BUILDS`。
- **同类问题影响**：所有 pnpm 11 工程；凡依赖 esbuild / keytar / @vscode/vsce-sign / prebuild-install 类原生模块的扩展。

## #3 pnpm 11.9 要求 Node ≥ 22.13（CI 用 Node 20 崩溃）

- **表因**：CI `Lint & Build` job 10s 内失败，日志 `Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite`，并告警 `This version of pnpm requires at least Node.js v22.13`。本地不暴露（本地用 Node 24）。
- **根因**：pnpm 11.9 内部使用 Node 22.13+ 才有的 `node:sqlite` 内置模块；CI 工作流配置 `node-version: 20`，pnpm 启动即崩。
- **处理方式**：CI 所有 job 的 `setup-node` 由 `node-version: 20` 升至 `node-version: 22`。
- **后续防范**：pnpm ≥ 11 工程的 Node 基线须 ≥ 22.13；`engines.node`/CI/本地三者对齐（建议 22 LTS 或 24）；升级 pnpm 前查其 Node 版本要求（https://r.pnpm.io/comp）。
- **同类问题影响**：所有 pnpm 11+ 的 CI/本地环境；node:sqlite 依赖的其他工具链。

## #4 CI 集成测试 job 缺失扩展构建步骤

- **表因**：CI `Test` job 集成测试报 `Activating extension 'threefish-ai.hyper-git' failed: Cannot find module '.../dist/extension.js'`；本地却通过。
- **根因**：`test` job 仅跑 `test:unit` + `test:integration`，未执行 `node esbuild.js` 构建 `dist/extension.js`；test-electron 启动真实 VS Code 加载扩展（`main: ./dist/extension.js`）时找不到入口。本地因先前 `pnpm run package` 残留 dist/ 而误判通过。
- **处理方式**：`test` job 在 `pnpm install` 后、测试前增加 `node esbuild.js`（或 `pnpm run compile`）构建 dist/。
- **后续防范**：凡含 `@vscode/test-electron` 集成测试的 CI job，必须在测试前显式构建扩展产物；本地验证集成测试后清理 dist/ 以暴露该依赖；`.gitignore` 排除 dist/ 时注意 CI 需重建。
- **同类问题影响**：所有 VS Code 扩展的 test-electron CI job；本地"能跑"但 CI 失败的构建产物缺失类问题。

## #5 ESLint flat config 遍历 .vscode-test 导致 OOM

- **表因**：本地 `pnpm run lint` 在 ~70s 后 `FATAL ERROR: ... JavaScript heap out of memory`（4GB 耗尽）；M0 时却正常。
- **根因**：`@vscode/test-electron` 首次运行将完整 VS Code（约 260MB、海量 JS）下载到 `.vscode-test/`；ESLint 9 flat config 默认仅忽略 `node_modules`，**不忽略 `.vscode-test/`**，于是 eslint 遍历其下成千上万 JS 文件导致 OOM。M0 lint 通过是因为当时 `.vscode-test/` 尚未生成。
- **处理方式**：在 `eslint.config.mjs` 的 `ignores` 增加 `.vscode-test/**`。
- **后续防范**：含 test-electron 的扩展，eslint ignores 必须含 `.vscode-test/**`（及 `out/**`、`dist/**`、`*.vsix`）；CI 因不缓存该目录可能不暴露，但本地必现——本地与 CI 环境差异需警惕。
- **同类问题影响**：所有跑过 test-electron 的本地环境的 eslint/其他静态分析工具。

## #6 vscode.git 公开 API add() 须传绝对路径

- **表因**：调用 `Repository.add(['README.md'])`（相对路径）无效或误加文件；CommitService 初期也曾困惑路径语义。
- **根因**：`extensions/git/src/api/api1.ts` 的 `add(paths)` 实现为 `paths.map(p => Uri.file(p))`——`Uri.file()` 要求**绝对路径**；相对路径会被包装成畸形 Uri，内部 `path.relative(root, ...)` 计算错误。`revert`/`clean`/`restore` 同理。
- **处理方式**：CommitService 始终传 `ChangeItem.uri.fsPath`（绝对）。
- **后续防范**：消费 vscode.git 公开 API 的路径类方法（add/revert/clean/restore）一律传绝对 fsPath；已加集成测试 `tests/suite/commit-flow.test.js` 守护。
- **同类问题影响**：所有消费 vscode.git API 做 stage/revert 的扩展；git CLI 本身接受相对路径，但**公开 API 层不接受**，二者语义差异易踩。

## #7 GitHub Release 缺少可本地安装的 `.vsix` 资产

- **表因**：README 指引「从 Releases 下载 `.vsix` → `Extensions: Install from VSIX`」，但 rc.1/rc.2 的 GitHub Release 页面无任何 `.vsix` 资产，用户无法手动安装。
- **根因**：`ci.yml` 的 `package` job 只把 `.vsix` 当作 **Actions artifact**（90 天即逝、非公开下载）上传，`publish` job 仅将其发往 VS Code Marketplace / OpenVSX；**全流程无任何 step 创建 GitHub Release 或向其上传资产**（rc.1/rc.2 的 Release 实为手工 `gh release create`，本就不含 `.vsix`）。
- **处理方式**：新增独立 `github-release` job（`softprops/action-gh-release@v2`），`needs: package` 复用 vsix artifact，对 `v*` tag 自动建 Release 并 `files: '*.vsix'` 上传；`*rc*` 自动 `prerelease`；`fail_on_unmatched_files: true` 防空资产。
- **后续防范**：该 job 与市场 `publish` **解耦**（不 `needs: publish`、不挂 `environment: production`），保证「Release 带 `.vsix`」不被市场审批门/密钥缺失阻塞；「仅出 Release、暂不发市场」时不审批 production 即可，无需改 publish job；最小权限仅本 job 提权 `contents: write`。
- **同类问题影响**：所有「CI 只上传 artifact + 发市场、却在 README 承诺 Release 手动下载」的 VS Code 扩展；artifact ≠ Release 资产，二者可见性/留存期差异易被忽视。

## #8 Branches 视图无法多选（批量删除等批量操作缺失）

- **表因**：用户截图反馈 Branches 视图中一组功能/工作分支无法框选多个、无法批量删除。
- **根因**：`hyperGit.branches` 经 `vscode.window.registerTreeDataProvider` 注册——该 API **不支持** `canSelectMany`，故视图天然单选；所有分支命令处理器亦只接收单个 `BranchNode`。多选能力（`canSelectMany: true`）仅 `createTreeView` 的 `TreeViewOptions` 支持。
- **处理方式**：改用 `createTreeView('hyperGit.branches', { treeDataProvider, canSelectMany: true })`（句柄入 subscriptions）。批量命令处理器签名扩展为 `(clickedNode, selectedNodes[])`——VS Code 多选树的 `view/item/context` 命令第 2 实参即完整选区数组。新增纯逻辑 `engine/ref/selection.collectBranchRefs`（谓词过滤 + shortName 去重 + 「点击在选区之外则以点击项为准」）与 `engine/ref/cleanup.partitionByMerged`/`formatBranchDeleteConfirm`，使 `branchDelete`/`tagDelete`/`copyBranchRef`/`toggleFavorite` 批量化（删除仅一次 `git branch --merged` 分类、汇总成功/失败、末尾单次刷新）。`package.json` 对仅单目标命令（检出/合并/变基/重命名/比较等）追加 `&& !listMultiSelection` 在多选时隐藏。
- **后续防范**：① 需要承载 `canSelectMany` 等 `TreeViewOptions` 能力的 **TreeView**，一律用 `createTreeView` 而非 `registerTreeDataProvider`（本仓 `hyperGit.branches` 即此）；`.badge` 则 `TreeView` 与 `WebviewView` **均支持**——`hyperGit.changes` 视图移除后（其活动 Changelist 与 Commit 视图重复），未提交数角标已迁至 Commit `WebviewView.badge`，注意 `WebviewView` 仅在 `resolveWebviewView` 后可置 badge，需 `pendingBadge` 兜底首帧未 resolve 的时序。② 多选命令正确性**只依赖处理器读取实参**（`clickedNode` + `selectedNodes[]`），不得依赖 `listMultiSelection` 上下文键——其对**自定义贡献视图**的可靠性无法确证，仅作菜单整洁的视觉优化；单目标命令因只读 `clickedNode` 即便该键失效仍安全。③ 「右键点击选区之外」须以点击项为准（手势目标优先），由归一化助手统一兜底。
- **同类问题影响**：所有以 `registerTreeDataProvider` 注册却后续需要多选/角标的自定义 TreeView；以及误把单目标命令在多选下直接作用于「点击项」造成的隐性误操作。

## #9 LOG 视图残留「已删分支」提交（实为工具注入的内部引用污染 `git log --all`）

- **表因**：用户截图反馈 LOG 的 All 范围下，一批本应随分支删除而消失的提交仍以游离泳道残留；运行「清理已删远程分支」（#44，`git fetch --prune`）后**依旧存在**。
- **根因**：`engine/log/log-query.ts` 的 `buildLogArgs` 对 `all`/`checkpointer` 范围下 `git log --all`。`--all` 遍历 `refs/` 下**全部**引用，不止 heads/remotes/tags——还包括宿主工具（如 Conductor）注入的 `refs/conductor-checkpoints/*`（会话快照）、`refs/conductor-archive-heads/*`（已删/被取代分支头的归档）。这些归档头让**真实的游离提交**（被 amend/rebase 取代、或分支删除后仅靠归档存活者）仍可达，画成游离泳道。而既有的客户端 `CHECKPOINT_SUBJECT_RE=/^checkpoint:/i` 过滤**只能拦住 checkpoint 元数据提交本身**，拦不住作为其祖先的游离业务提交——故泄漏。`git fetch --prune` 仅清理 `refs/remotes/*`，对上述非远端跟踪引用**完全无效**，这正是「prune 后依旧存在」的根因。实证：本仓 `--all` 取 241 提交、`--branches --tags --remotes` 仅 70；refs 命名空间 135 conductor-checkpoints + 17 conductor-archive-heads，远多于 3 heads/3 remotes/2 tags。
- **处理方式**：`all` 范围由 `--all` 改为 `--branches --tags --remotes`（仅三大标准命名空间，排除一切工具注入的内部引用），根治游离泳道；`checkpointer` 范围**保留 `--all`**——该 Tab 的职责即「原始完整视图，含内部 checkpoint 快照」，需触达 `refs/conductor-checkpoints/*`。客户端 `keepCheckpoint` 过滤作为双保险保留。更新 `tests/unit/log-query.test.ts` 断言（`all` 含三件套、不含 `--all`；`checkpointer` 含 `--all`、不叠三件套）作回归护栏。
- **后续防范**：① 「全分支视图」语义应映射到 `--branches --tags --remotes` 而非 `--all`——`--all` 是「全部引用」而非「全部分支」，二者差异恰是工具注入引用的污染面。② 客户端按提交 message 正则过滤是**漏的抽象**（拦不住作为祖先被带入的游离提交）；根治应在 ref 选取层（服务端参数）而非 subject 过滤层。③ **诊断 git 引用类问题时务必先 `git for-each-ref` 列出全部命名空间**——本案最初误判为「远端已删、本地未 prune」（#44 与一度推进的 prune-on-fetch 方案均为此误判），直到列出 refs 才发现真凶是 conductor-* 引用；「prune 无效」本身就是关键反证，应据其反向收敛而非强行加 prune。④ 修正「错漏逻辑」前先用 `git log --all` vs `--branches --tags --remotes` 的差集实证根因，避免再次基于关键字匹配机械式修改。
- **同类问题影响**：所有在带「工具注入内部引用」环境（IDE/Agent checkpoint、`refs/stash`、`refs/replace/*`、`refs/notes/*` 等）下展示 `git log --all` 图的 Git GUI；凡把「范围 = 引用集合」与「范围 = message 过滤」混为一谈的实现均可能漏过游离提交。

## #10 活动栏未提交数角标更新不及时（WebviewView.badge resolve 前不显示）

- **表因**：用户截图反馈 Hyper Git 活动栏图标的未提交变更数角标更新不及时——有时已有变更却不显示角标，有时文件已提交/撤销角标仍不消失。
- **根因**：角标承载于 Commit `WebviewView.badge`（#8 移除 Changes 视图后迁入）。命中 VS Code 已知限制：webview 角标在 `resolveWebviewView`（即用户至少打开过一次该视图）之前无法显示（[microsoft/vscode#164974](https://github.com/microsoft/vscode/issues/164974)、[#146330](https://github.com/microsoft/vscode/issues/146330)）；源码印证 `commit-webview.ts` 未 resolve 时 `updateBadge` 仅写入 `pendingBadge`、永不上屏，`WebviewView.onDidDispose` 亦仅在用户显式取消勾选视图时触发。故只要面板未打开/隐藏（用户在编辑器或其他活动容器工作），新变更无法点亮、提交/撤销后无法清除。#8 的「后续防范」已预警此 `pendingBadge` 首帧时序隐患，本 Issue 即其兑现。TreeView 无此限制——`createTreeView` 可在 activate 强制实例化视图对象，`.badge` 无论可见与否都可靠聚合到容器图标（容器角标 = 容器内各视图 badge 之和）。
- **处理方式**：新增隐藏承载视图 `hyperGit.changesBadge`（package.json `when:false`，永不渲染，复用 `EmptyTreeProvider`），经 `createTreeView` 于 activate 即实例化并置 `.badge`；角标承载由 Commit WebviewView 整体迁出（移除 `updateBadge`/`pendingBadge` 死代码，杜绝容器求和 2× 计数）。新增 `engine/scm-mapping/change-count.ts`（`toRelKey`/`countUniqueChanges`）作为去重单一事实源，`GitRepositoryService.getChangeCount()` 与 `getChanges()` 共用；角标走独立 40ms 微防抖快路径（与 150ms 重刷新解耦、合并事件风暴、释放期清理定时器），首帧同步置初值。
- **后续防范**：① 需要「面板未打开也持续显示」的活动栏计数角标，**必须**承载于 `createTreeView` 建立的 TreeView（可用 `when:false` 隐藏视图专职承载），**不可**依赖 `WebviewView.badge`——其 resolve 前不显示是 VS Code 已知限制而非本仓 bug；这与 #8「`.badge` TreeView/WebviewView 均支持」并行：「支持置 badge」≠「未 resolve 也上屏」。② 容器角标为**各视图 badge 之和**，全仓须保证**唯一承载者**，迁移承载时务必删除旧承载，否则重复计数。③ 计数与文件列表去重须共用单一事实源（`toRelKey`），避免「列表条目数 ≠ 角标数」漂移。④ `when:false` 承载视图的实机角标渲染需在 EDH 回归确认（跨 VS Code 版本聚合行为），失败则回退为 `visibility:collapsed` 的空视图。
- **同类问题影响**：所有以 `WebviewView.badge` 承载活动栏/视图角标的自定义视图容器扩展；凡角标承载迁移未清理旧承载导致的重复计数；以及把「支持 badge 属性」误判为「隐藏态也能显示 badge」的时序类误区。

## #11 VS Code Marketplace 预发布 publish 失败（VSIX 未以 `--pre-release` 打包）

- **表因**：以 rc tag（`v0.0.10-rc.1`）触发发布时，`publish` job 的「发布到 VS Code Marketplace」步骤报错 `Cannot use '--pre-release' flag with a package that was not packaged as pre-release. Please package it using the '--pre-release' flag and publish again.`，job 失败；其后的 OpenVSX 步骤（虽 `continue-on-error`）因前序步骤失败被 skipped，致三渠道仅 `github-release` 成功、Marketplace/OpenVSX 均未发出。
- **根因**：`package` job 以 `vsce package --no-yarn`（**不带** `--pre-release`）打出「正式版」VSIX 作为 artifact；`publish` job 却对 rc tag 用 `vsce publish --packagePath *.vsix --pre-release`。vsce 强约束——以 `--pre-release` 发布的 VSIX 必须在**打包时**即带 `--pre-release`（预发布标志写入 VSIX manifest），否则拒绝发布。打包端与发布端的 `--pre-release` 判定不对称即致此错。历史 rc（0.0.9-rc.*）从未真正发到市场（Marketplace 步骤因缺 `VSCE_PAT`/变量被跳过），故该缺陷此前从未被触发暴露。
- **处理方式**：`package` job 打包步骤改为与 publish/OpenVSX 同款 `PRE_FLAG` 判定——`GITHUB_REF_NAME` 含 `rc` 时追加 `--pre-release`，使同一枚「预发布 VSIX」贯穿 `github-release` / Marketplace / OpenVSX 三渠道（单一产物、零重复打包）。正式版 tag（无 `rc`）与分支/PR CI 仍打普通 VSIX，行为不变。
- **后续防范**：① VS Code 预发布模型下，**打包与发布两端的 `--pre-release` 必须成对出现**；凡「先 package 成 artifact、后 publish 复用同一枚 VSIX」的流水线，预发布判定要在 package 端就落地，不能只在 publish 端加 flag。② 预发布版本号仍须纯 `major.minor.patch`（Marketplace 不接受 `-rc.N` semver 后缀），预发布语义由 `--pre-release` 标志 + tag 命名承载；`0.0.10` 作预发布后正式版须用更高版本（如 `0.0.11`），同一版本号不可既预发布又正式发布。③ OpenVSX 步骤的 `continue-on-error` 只隔离其自身失败——前序 Marketplace 步骤失败仍会使其 skipped；排障时勿因「OpenVSX 未报错」误判其已发布，须查其步骤实际状态与日志。④ Marketplace 发布链路的双凭证不可混淆：`VSCE_PAT`（Azure DevOps PAT，scope Marketplace→Manage）与 `OVSX_PAT`（open-vsx.org token）是不同服务的两个不同 token，且 Marketplace 发布还受仓库变量 `ENABLE_MARKETPLACE_PUBLISH` 门控。
- **同类问题影响**：所有「package 出 artifact → publish 复用」且需发布预发布通道的 VS Code 扩展 CI；凡打包端与发布端 flag 判定不对称（`--pre-release`、平台化 `--target` 等同理）的流水线均会踩。

## #12 侧边栏视图无法解除最小展开高度（VS Code 核心硬编码 120px + #123715 已 not planned）

- **表因**：用户反馈 Worktrees 视图展开后无法继续缩小（截图中仍占大片空白），要求「所有视图可拖到任意高度、取消最小高度限制」。
- **根因**：侧边栏每个视图面板（`Pane`）的最小体高由 VS Code 核心**硬编码 = 120px**（竖直方向；构造函数 `this._minimumBodySize = ... orientation === HORIZONTAL ? 200 : 120`，见 `src/vs/base/browser/ui/splitview/paneview.ts`），加 22px 标题栏，展开态最小 ≈ **142px**，该值经 `minimumSize` 直接驱动 SplitView 拖拽分隔条下限。`WebviewViewPane extends ViewPane` **未覆写** `minimumBodySize`，故本扩展 2 个 webview（Commit/Graph）与 4 个 tree（Branches/Stash/Shelf/Worktrees）视图**共用同一 142px 下限**。允许扩展为活动栏容器内视图指定固定/最小/最大高度的官方特性请求 [microsoft/vscode#123715](https://github.com/microsoft/vscode/issues/123715) 已被**关闭为 not planned / out-of-scope**，从未新增任何 API 或 `package.json` 贡献点。扩展运行于独立进程，拿不到工作台面板对象，`minimumBodySize` setter 仅核心 `ViewPaneContainer` 调用；注入 CSS 亦无效（`.pane-body{min-height:0}` 改不动 JS 层用于夹取拖拽下限的 `minimumSize`）。
- **处理方式**：该限制**无法经扩展解除**，采用受支持的折中缓解——在 `package.json` `contributes.views` 调初始布局默认值：次要视图 Stash/Shelf 设 `visibility:"collapsed"`（默认仅 22px 标题栏、点击即展开），Worktrees 保持 `visible`（仅以 `initialSize` 权重收窄），全部视图加 `initialSize`（Commit 3 / Graph 3 / Branches 2 / 其余 1，类 CSS flex 的高度权重）。两字段经 `src/vs/workbench/api/browser/viewsExtensionPoint.ts` 的 `viewDescriptor` schema 确认可用；`initialSize` **仅当「同一扩展同时拥有视图与视图容器」时生效**（本扩展拥有 `hyper-git` 容器与全部视图，条件满足）。
- **后续防范**：① VS Code 侧边栏视图存在约 **142px 硬性最小展开高度**，无法经扩展降低——遇「任意高度 / 无最小高度」类诉求应直接引 #123715（not planned）说明平台边界，**勿承诺实现**；判断「webview 内容 CSS `min-height`」与「外层面板最小高度」是两回事。② `visibility` / `initialSize` **只影响初始状态**（「用户手动折叠/移动/隐藏过后即不再生效」）——老用户需命令面板「View: Reset View Locations」或右键容器图标「Reset Location」才采用新默认；实机验证须用**干净 profile 或先重置**以规避持久化布局。③ 想让展开视图更紧凑，只能靠「减少常驻视图数（默认折叠）+ 权重」，而非解除下限。
- **同类问题影响**：所有向活动栏/侧边栏容器贡献 TreeView/WebviewView 且希望自定义或取消视图高度的扩展；凡把「webview 内容 `min-height` CSS」误认为能改变外层面板最小高度的实现。

## #13 视图容器由活动栏迁移至底部 Panel（dock 决定 badge 可见性上限 + 页签顺序不可控）

- **表因**：用户要求将 Hyper Git 视图容器从默认的活动栏（Activity Bar / Primary Side Bar）迁移到底部面板（Panel），并希望排在 Terminal 页签之后。
- **根因**：`contributes.viewsContainers` 的 `activitybar` 与 `panel` 是 dock 选择键，VS Code 通过容器 id 关联 `viewsContainers` 与 `views`，**容器挂在哪个 dock 与 views 归属、API 调用、图标规范完全解耦**——故迁移仅需将 `package.json` 中 `"activitybar"` 改为 `"panel"`，容器 id `hyper-git` 与全部 7 个视图、`.ts` 源码、`media/hyper-git-icon.svg`（24×24 单色 `currentColor`）均无需改动（`engines.vscode: ^1.85.0` ≫ panel 容器所需 1.56+）。
- **处理方式**：单行改动 `viewsContainers.activitybar` → `viewsContainers.panel`，并 bump `0.0.12` → `0.0.13`。用户经评估后**明确接受 trade-off**（见下），不引入双容器或状态栏计数器。
- **后续防范**：
  1. **Panel 容器相对内置页签顺序不可控**：VS Code **不提供**任何 contribution point 控制 panel 容器相对内置页签（Terminal/Output/Problems/Debug）的顺序；默认行为是新装扩展的容器**追加在内置页签之后**，用户可拖拽并持久化。遇「精确紧邻某内置页签」类诉求应直接说明平台边界，**勿承诺实现**。
  2. **dock 迁移改变 `initialSize` 语义**：`initialSize` 是容器主轴方向的权重（类 flex-grow）；侧边栏主轴=垂直（高度权重），Panel 默认主轴=水平（宽度权重）。值本身无需改，但语义随用户布局方向变化；遇视图过挤应调权重而非解除下限（与 #12 同一硬编码边界）。
  3. **dock 决定 badge 可见性上限**（关键）：activitybar 容器图标支持「未聚焦也聚合显示」的一等 badge（#10 据此实现「面板未打开也持续显示」）；**panel 容器页签 badge 的可见性受 Panel 展开/收起态约束**。`when:false` TreeView 在 panel dock 下的聚合可见性需 EDH 实测（跨 VS Code 版本）。本案用户**明确接受**此 trade-off——未提交计数仅在 Panel 展开时可见，不触发双容器回退；若后续需恢复「始终可见」计数，应走双容器（panel 主 + activitybar badge 专用）或状态栏计数器方案。
  4. **dock 迁移属用户可见布局变更**：VS Code 会记忆旧 dock 位置，老用户升级后需「View: Reset View Locations」或右键容器页签「Reset Location」才采用新默认（与 #12 同款平台行为，实机验证须用干净 profile）。
- **同类问题影响**：所有在 activitybar/panel 间迁移自定义视图容器的扩展；凡依赖容器图标 badge「始终可见」语义的扩展；以及把「dock 迁移」误当作纯内部重构而忽视 badge 可见性回退的实现。


