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
- **后续防范**：① 需要承载 `.badge` 或 `canSelectMany` 等 `TreeViewOptions` 能力的视图，一律用 `createTreeView` 而非 `registerTreeDataProvider`（本仓 `hyperGit.changes` 已有先例）。② 多选命令正确性**只依赖处理器读取实参**（`clickedNode` + `selectedNodes[]`），不得依赖 `listMultiSelection` 上下文键——其对**自定义贡献视图**的可靠性无法确证，仅作菜单整洁的视觉优化；单目标命令因只读 `clickedNode` 即便该键失效仍安全。③ 「右键点击选区之外」须以点击项为准（手势目标优先），由归一化助手统一兜底。
- **同类问题影响**：所有以 `registerTreeDataProvider` 注册却后续需要多选/角标的自定义 TreeView；以及误把单目标命令在多选下直接作用于「点击项」造成的隐性误操作。

## #9 LOG 视图残留「已删分支」提交（实为工具注入的内部引用污染 `git log --all`）

- **表因**：用户截图反馈 LOG 的 All 范围下，一批本应随分支删除而消失的提交仍以游离泳道残留；运行「清理已删远程分支」（#44，`git fetch --prune`）后**依旧存在**。
- **根因**：`engine/log/log-query.ts` 的 `buildLogArgs` 对 `all`/`checkpointer` 范围下 `git log --all`。`--all` 遍历 `refs/` 下**全部**引用，不止 heads/remotes/tags——还包括宿主工具（如 Conductor）注入的 `refs/conductor-checkpoints/*`（会话快照）、`refs/conductor-archive-heads/*`（已删/被取代分支头的归档）。这些归档头让**真实的游离提交**（被 amend/rebase 取代、或分支删除后仅靠归档存活者）仍可达，画成游离泳道。而既有的客户端 `CHECKPOINT_SUBJECT_RE=/^checkpoint:/i` 过滤**只能拦住 checkpoint 元数据提交本身**，拦不住作为其祖先的游离业务提交——故泄漏。`git fetch --prune` 仅清理 `refs/remotes/*`，对上述非远端跟踪引用**完全无效**，这正是「prune 后依旧存在」的根因。实证：本仓 `--all` 取 241 提交、`--branches --tags --remotes` 仅 70；refs 命名空间 135 conductor-checkpoints + 17 conductor-archive-heads，远多于 3 heads/3 remotes/2 tags。
- **处理方式**：`all` 范围由 `--all` 改为 `--branches --tags --remotes`（仅三大标准命名空间，排除一切工具注入的内部引用），根治游离泳道；`checkpointer` 范围**保留 `--all`**——该 Tab 的职责即「原始完整视图，含内部 checkpoint 快照」，需触达 `refs/conductor-checkpoints/*`。客户端 `keepCheckpoint` 过滤作为双保险保留。更新 `tests/unit/log-query.test.ts` 断言（`all` 含三件套、不含 `--all`；`checkpointer` 含 `--all`、不叠三件套）作回归护栏。
- **后续防范**：① 「全分支视图」语义应映射到 `--branches --tags --remotes` 而非 `--all`——`--all` 是「全部引用」而非「全部分支」，二者差异恰是工具注入引用的污染面。② 客户端按提交 message 正则过滤是**漏的抽象**（拦不住作为祖先被带入的游离提交）；根治应在 ref 选取层（服务端参数）而非 subject 过滤层。③ **诊断 git 引用类问题时务必先 `git for-each-ref` 列出全部命名空间**——本案最初误判为「远端已删、本地未 prune」（#44 与一度推进的 prune-on-fetch 方案均为此误判），直到列出 refs 才发现真凶是 conductor-* 引用；「prune 无效」本身就是关键反证，应据其反向收敛而非强行加 prune。④ 修正「错漏逻辑」前先用 `git log --all` vs `--branches --tags --remotes` 的差集实证根因，避免再次基于关键字匹配机械式修改。
- **同类问题影响**：所有在带「工具注入内部引用」环境（IDE/Agent checkpoint、`refs/stash`、`refs/replace/*`、`refs/notes/*` 等）下展示 `git log --all` 图的 Git GUI；凡把「范围 = 引用集合」与「范围 = message 过滤」混为一谈的实现均可能漏过游离提交。


