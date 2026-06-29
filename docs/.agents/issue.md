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


