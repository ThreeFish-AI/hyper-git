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
