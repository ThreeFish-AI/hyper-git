# VS Code 扩展工程蓝图:技术栈决策 + 工程骨架 + IDEA→VS Code UI 表面映射表

> 本文档面向 Track3,目标:让开发可立即落地。所有事实论断均附 GitHub 路径或官方文档 URL,不确定处标注「待核实」。遵循 AGENTS.md 的熵减、正交分解、复用驱动、单一事实源原则。

## 一、技术栈决策表

| 维度 | 决策 | 理由与证据 | 次选/风险 |
|------|------|-----------|-----------|
| **语言** | **TypeScript(strict)** | VS Code 官方与 `vscode-extension-samples` 全量使用 TS;`@types/vscode` 提供完整类型,版本由 `engines.vscode` 锁定。[Extension Anatomy](https://code.visualstudio.com/api/get-started/extension-anatomy) | — |
| **打包** | **esbuild**(CJS format) | 官方 `esbuild-sample` 已默认 esbuild,推荐优先于 webpack。`format: 'cjs'`、`platform: 'node'`、`external: ['vscode']`、`bundle: true`。[官方 esbuild.js](https://github.com/microsoft/vscode-extension-samples/blob/master/esbuild-sample/esbuild.js) / [Bundling Extensions](https://code.visualstudio.com/api/working-with-extensions/bundling-extension) | webpack(历史遗留项目可用) |
| **类型检查** | **tsc --noEmit 独立运行** | esbuild 仅 strip 类型、不做类型检查,故需 `tsc --noEmit` 并行。`esbuild-sample/package.json` 的 `scripts` 体现:`compile = check-types && lint && esbuild`。[package.json](https://github.com/microsoft/vscode-extension-samples/blob/master/esbuild-sample/package.json) | — |
| **单元测试** | **Vitest**(纯逻辑层,不含 vscode API) | Vitest 速度快、API 与 Jest 兼容。**关键约束**:Vitest 仅用于 `engine/adapter` 中不依赖 `vscode` 命名空间的纯函数(git 解析、diff 算法、变更分组)。ESM-only 与 VS Code 扩展宿主 CJS 不兼容,故**禁止**把 Vitest 套进扩展宿主集成测试。[vitest-dev/vscode Issue #168](https://github.com/vitest-dev/vscode/issues/168) | mocha(若团队更熟悉) |
| **集成测试** | **@vscode/test-electron + Mocha** | 官方唯一推荐路径,在 Extension Development Host 内运行,可访问真实 `vscode` API。Linux CI 需 `xvfb-run`。[Testing Extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension) | — |
| **测试时长** | 单元 < 30s,集成 < 2min,**总计 < 3min** | 契合 AGENTS.md「本地运行 < 3 min」。策略:Vitest 默认 worker 并行 + 仅对 `engine/` 跑;集成测试用最小 fixture 仓库 + `--grep` 分片。 | — |
| **Lint** | **ESLint 9 flat config + typescript-eslint** | `esbuild-sample` 已采用 `@eslint/js` + `typescript-eslint` + `@stylistic/eslint-plugin`。[package.json devDeps](https://github.com/microsoft/vscode-extension-samples/blob/master/esbuild-sample/package.json) | — |
| **格式化** | **Prettier**(与 ESLint 解耦,仅管格式) | 避免 stylistic 插件与 Prettier 职责重叠,`@stylistic/eslint-plugin` 仅保留 ESLint 无法覆盖项 | — |
| **包管理器** | **pnpm**(用户硬约束) | AGENTS.md「JS/TS 必须用 pnpm」。注意:`vsce package` 与 `.vsix` 打包兼容 pnpm,但需在 `package.json` 声明 `packageManager` 字段并配 `.npmrc` 的 `node-linker=hoisted` 以规避某些原生依赖 hoisting 问题 | — |
| **发布打包** | **@vscode/vsce**(`vsce package` → `.vsix`) | 官方打包工具,`vscode:prepublish` 触发 esbuild production bundle。[Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) | — |
| **engines.vscode 基线** | **`^1.85.0`**(Nov 2023) | 见下方「engines.vscode 版本策略」专节 | — |

**关于 engines.vscode 版本策略**:VS Code API 一旦稳定即向后兼容(扩展在更高版本无条件运行);基线越低可用 API 越少。`@types/vscode` 的 `devDependencies` 版本**必须**与 `engines.vscode` 的最低版本一致(而非最新),这样若误用更高版本 API,`tsc` 会编译失败。本项目当前基线分支为 `feature/1.x.x`,结合 2026 年 6 月的时间点,目标扩展主版本建议设为 `1.x`(与分支呼应),`engines.vscode` 锁定 `^1.85.0` 以获得稳定且足够现代的 API 面(含 SCM、Tree、Webview 全部所需稳定 API)。证据:[Extension Manifest](https://code.visualstudio.com/api/references/extension-manifest) / [vscode-discussions #2437](https://github.com/microsoft/vscode-discussions/discussions/2437)。

---

## 二、工程骨架蓝图

### 2.1 目录树(呼应 AGENTS.md 正交分解:Engine/Adapter/Agent/UI)

```
sofia-git/
├── .vscode/
│   ├── launch.json          // Extension Host + Webview 调试配置
│   ├── tasks.json           // esbuild watch / tsc --noEmit tasks
│   └── recommended-settings.json
├── esbuild.js               // 沿用官方 esbuild-sample 范式
├── .vscodeignore            // 排除 src/、tests/、node_modules
├── package.json             // Extension Manifest + contributes
├── tsconfig.json            // strict, outDir 标记对纯逻辑层可见
├── eslint.config.mjs        // flat config
├── .prettierrc
├── pnpm-lock.yaml
├── .npmrc                   // node-linker=hoisted(规避 vsce/pnpm hoisting)
│
├── src/
│   ├── extension.ts         // 唯一入口:activate/deactivate,仅做装配(DI)
│   │
│   ├── engine/              // 【引擎层】与 VS Code 无关的纯领域逻辑,可独立测试
│   │   ├── git/             //   git 命令封装:status/diff/log/blame/branch/stash/shelve 语义解析
│   │   ├── model/           //   领域模型:FileChange、Changelist、Commit、Branch、StashEntry
│   │   ├── diff/            //   diff 计算与行级 patch(partial commit 基础)
│   │   └── scm-mapping/     //   文件状态色映射:M/A/D/U/Renamed/Copied → decorations
│   │
│   ├── adapter/             // 【适配层】桥接 engine ↔ vscode API,封装 I/O 与翻译
│   │   ├── scm/             //   SourceControlProvider 实现(createSourceControl/ResourceGroup)
│   │   ├── tree/            //   TreeDataProvider 实现(Local Changes、Branches、Log、Shelf、Stash)
│   │   ├── webview/         //   WebviewView 宿主(Commit 窗口、Log 图)+ postMessage 协议
│   │   ├── diff/            //   TextDocumentContentProvider 自定义 diff 源(scheme 注册)
│   │   ├── commands/        //   command 注册与分发,menu when-clause 上下文键
│   │   └── storage/         //   globalState/workspaceState/SecretStorage 封装
│   │
│   ├── agent/               // 【代理层】AI 能力(预留),与 engine/adapter 解耦
│   │   ├── commit-message/  //   AI 提交信息生成
│   │   ├── review/          //   提交前 AI 代码审查
│   │   ├── semantic-group/  //   AI 变更语义分组
│   │   ├── conflict/        //   AI 冲突解决
│   │   └── llm-client/      //   抽象 LLM 适配(支持多 provider)
│   │
│   ├── ui/                  // 【UI 层】Webview 前端产物(独立 esbuild/web bundle)
│   │   ├── commit-view/     //   Commit 提交窗口 React/Preact 前端
│   │   ├── log-graph/       //   Log 提交图渲染(SVG/Canvas 自绘 graph)
│   │   └── shared/          //   共享组件 + postMessage 类型契约
│   │
│   ├── shared/              // 【契约层】跨层共享类型(webview↔host 消息协议、常量)
│   │   └── protocol.ts      //   单一事实源:message type 定义
│   │
│   └── infra/               // 【基础设施】日志、错误处理、事件总线、配置读取
│
├── media/                   // 图标(SVG)、Commit 窗口 webview 的 HTML/CSS 入口
│
└── tests/
    ├── unit/                // Vitest:engine/* 与 diff/scm-mapping 纯逻辑
    ├── integration/         // @vscode/test-electron + Mocha:adapter/* 适配层
    └── fixtures/            // 测试用 git 仓库快照(最小化)
```

**职责边界说明(单一事实源 + 正交分解)**:
- `engine/` 零依赖 `vscode`,可被 Vitest 与未来 CLI 双复用,是项目核心 IP。
- `adapter/` 是唯一接触 `vscode` API 的层(除 `extension.ts`),把引擎领域模型翻译为 SCM/Tree/Webview 表面。
- `agent/` 依赖 `engine/` 但不依赖 `adapter/`,确保 AI 能力可独立演进与替换 provider。
- `shared/protocol.ts` 是 webview↔extension 通信的**唯一类型契约源**,前端与宿主共同引用,杜绝双份定义。
- `ui/` 前端走独立 bundle(esbuild `format: 'iife'`),产物放 `media/`。

### 2.2 package.json 核心 contributes 片段示意

以下聚焦本项目所需的 `viewsContainers` / `views` / `commands` / `menus` / `configuration` / `keybindings`,语法遵循 [Contribution Points](https://code.visualstudio.com/api/references/contribution-points)。

```jsonc
{
  "name": "sofia-git",
  "displayName": "Sofia Git",
  "engines": { "vscode": "^1.85.0" },
  "main": "./dist/extension.js",
  "contributes": {
    "viewsContainers": {
      // 活动栏(最左侧)新增容器;也支持 activitybar/panel
      "activitybar": [
        {
          "id": "sofia-git",
          "title": "Sofia Git",
          "icon": "media/sofia-git-icon.svg"
        }
      ]
    },
    "views": {
      // Commit 提交窗口用 WebviewView 放 Secondary Side Bar 槽位
      "sofia-git-commit": [
        { "id": "sofiaGit.commitView", "name": "Commit", "type": "webview" }
      ],
      // Local Changes / Branches / Log / Shelf / Stash 用 TreeView
      "sofia-git": [
        { "id": "sofiaGit.localChanges", "name": "Local Changes" },
        { "id": "sofiaGit.branches",     "name": "Branches" },
        { "id": "sofiaGit.log",          "name": "Log" },
        { "id": "sofiaGit.shelf",        "name": "Shelf" },
        { "id": "sofiaGit.stash",        "name": "Stash" }
      ]
    },
    "viewsWelcome": [ /* 空仓库欢迎视图 */ ],
    "commands": [
      { "command": "sofiaGit.commit",          "title": "Commit",           "icon": "$(check)" },
      { "command": "sofiaGit.commitAndPush",   "title": "Commit and Push",  "icon": "$(cloud-upload)" },
      { "command": "sofiaGit.stage",           "title": "Stage",            "icon": "$(add)" },
      { "command": "sofiaGit.unstage",         "title": "Unstage",          "icon": "$(remove)" },
      { "command": "sofiaGit.moveChangelist",  "title": "Move to Changelist" },
      { "command": "sofiaGit.shelve",          "title": "Shelve Changes" },
      { "command": "sofiaGit.unshelve",        "title": "Unshelve Silently" },
      { "command": "sofiaGit.stashCreate",     "title": "Stash Changes" },
      { "command": "sofiaGit.stashApply",      "title": "Apply Stash" },
      { "command": "sofiaGit.branchCreate",    "title": "New Branch" },
      { "command": "sofiaGit.branchCheckout",  "title": "Checkout" },
      { "command": "sofiaGit.diffWithHead",    "title": "Compare with HEAD" },
      { "command": "sofiaGit.showHistory",     "title": "Show History" }
    ],
    "menus": {
      // 视图标题栏操作
      "view/title": [
        { "command": "sofiaGit.commitAndPush", "when": "view == sofiaGit.commitView", "group": "navigation" }
      ],
      // 树节点右键:Local Changes 文件项
      "view/item/context": [
        { "command": "sofiaGit.stage",        "when": "view == sofiaGit.localChanges && viewItem == fileChange", "group": "1_modify@1" },
        { "command": "sofiaGit.moveChangelist","when": "view == sofiaGit.localChanges && viewItem == fileChange", "group": "1_modify@2" }
      ],
      // SCM 视图集成(若走 SCM API)
      "scm/resourceState/context": [
        { "command": "sofiaGit.moveChangelist", "when": "scmProvider == sofia-git", "group": "1_modify@2" }
      ],
      // 命令面板的命令可见性控制
      "commandPalette": [
        { "command": "sofiaGit.shelve", "when": "false" } // 仅右键触发,不在面板暴露
      ]
    },
    "keybindings": [
      { "command": "sofiaGit.commit", "key": "ctrl+enter", "mac": "cmd+enter", "when": "editorTextFocus && sofiaGit.commitInputFocus" }
    ],
    "configuration": {
      "title": "Sofia Git",
      "properties": {
        "sofiaGit.commit.template":      { "type": "string", "default": "", "description": "Commit message 模板" },
        "sofiaGit.commit.conventional":  { "type": "boolean", "default": true, "description": "Conventional Commits 校验" },
        "sofiaGit.log.graphTheme":       { "type": "string", "default": "classic" },
        "sofiaGit.agent.enabled":        { "type": "boolean", "default": false, "description": "启用 AI 代理能力" },
        "sofiaGit.agent.provider":       { "type": "string", "enum": ["claude","openai"], "default": "claude" }
      }
    }
  },
  "scripts": {
    "vscode:prepublish": "pnpm run package",
    "compile":   "pnpm run check-types && pnpm run lint && node esbuild.js",
    "watch":     "pnpm npm-run-all -p watch:*",
    "watch:esbuild": "node esbuild.js --watch",
    "watch:tsc":     "tsc --noEmit --watch -p tsconfig.json",
    "package":  "pnpm run check-types && pnpm run lint && node esbuild.js --production",
    "check-types": "tsc --noEmit",
    "lint": "eslint",
    "test:unit":       "vitest run",
    "test:integration": "node ./tests/run-integration.js"
  }
}
```

> `activationEvents: []` 空数组即可:`onCommand`、`onView`、`onStartupFinished` 等已可由 `contributes` 自动推断(自 1.74 起)。[Extension Anatomy](https://code.visualstudio.com/api/get-started/extension-anatomy)

---

## 三、IDEA → VS Code UI 表面映射表

> 对照 Track1 的功能区域,逐一映射到具体 VS Code API。核心决策:**Local Changes 走 SCM API(复用原生 Source Control 视图)**,而非自建 TreeView,以最大化复用原生 diff/stage/discard 能力(复用驱动)。

| IDEA 功能区域 | VS Code 实现载体 | 关键 API / 贡献点 | 关键设计点 |
|--------------|-----------------|------------------|-----------|
| **统一 Git 工具窗口(顶部容器)** | Activity Bar 视图容器 + 视图槽位 | `viewsContainers.activitybar` + `views` + 拖入 Secondary Side Bar | 一个 `sofia-git` 容器承载所有 TreeView;Commit 窗口作为 `type:"webview"` 视图,可置 Secondary Side Bar |
| **Commit 提交窗口** | **WebviewView**(Commit 窗口主体) + **SCM Input Box**(原生 commit 输入,可选) | `vscode.window.registerWebviewViewProvider` / `sourceControl.inputBox` / `acceptInputCommand` | 主体走 WebviewView 以承载模板、Conventional 校验、Amend/Author 控件;Ctrl+Enter 提交通过 `keybindings` + `when` 子句锚定。证据:[Source Control API - SCM Input Box](https://code.visualstudio.com/api/extension-guides/scm-provider) |
| **Commit / Commit and Push 按钮** | 视图标题栏 inline 图标按钮 | `menus: view/title` + `group: "navigation"` + `$(check)`/`$(cloud-upload)` codicon | navigation 组内联渲染,溢出自动进 `…` 菜单 |
| **Changes 变更文件树(多 changelist)** | **SCM ResourceGroup**(主) — 每个 changelist = 一个 ResourceGroup | `vscode.scm.createSourceControl(id,'Sofia Git')` + `sourceControl.createResourceGroup(id,label)` | 与原生 Git 一致的设计:Staged / Local Changes 各为 group。证据:[Source Control API - Source Control Model](https://code.visualstudio.com/api/extension-guides/scm-provider) |
| **文件状态色 M/A/D/U/Renamed/Copied** | `SourceControlResourceState` + `SourceControlResourceDecorations` + `ThemeColor` | `decorations: { iconPath, strikeThrough, faded, tooltip }`、`letter`、`color: new ThemeColor('gitDecoration.modified')` | 复用 `gitDecoration.*` 主题色 token 保持视觉一致。证据:[Source Control API](https://code.visualstudio.com/api/extension-guides/scm-provider) / [vscode.SourceControlResourceState](https://vshaxe.github.io/vscode-extern/vscode/SourceControlResourceState.html) |
| **Commit Message 多行编辑区 + 模板/校验** | WebviewView 内多行 `<textarea>` + 模板逻辑在 `engine/` | webview 前端 + `shared/protocol.ts` 消息协议 | 校验逻辑下沉 `engine/`,webview 仅渲染结果 |
| **move changes / active changelist** | `scm/resourceState/context` 菜单 + 命令重设 group 的 `resourceStates` | `menus: scm/resourceState/context` | 同一文件可跨 group 移动(原生支持) |
| **右侧 diff 预览** | 原生 diff(`vscode.diff`) + 自定义 diff 源 | `vscode.commands.executeCommand('vscode.diff', leftUri, rightUri)` + `registerTextDocumentContentProvider`(自定义 scheme 提供 HEAD 版本内容) | 单击 ResourceState 时,其 `command` 字段触发 diff。证据:[Source Control API - Source Control View](https://code.visualstudio.com/api/extension-guides/scm-provider) |
| **partial commit / selective commit / 行级** | 原生 Quick Diff 行级暂存 + 自定义 `scm/change/title` 命令 | `quickDiffProvider` + `scm/change/title` 菜单 + `stageChange(uri, changes, index)` | 行级暂存复用原生能力,`engine/diff/` 提供行级 patch 计算 |
| **Log 提交图(graph)** | **Webview**(全功能 graph 自绘) | `WebviewView` + 前端 SVG/Canvas 渲染 + `postMessage` 传输 commit 列表 | graph 自绘(参考 GitLens 风格),而非 TreeView(TreeView 无法绘制连线)。证据:[Webview API](https://code.visualstudio.com/api/extension-guides/webview) |
| **Log 搜索/作者/路径/日期过滤/blame** | Webview 内过滤器 + `engine/git/` 执行 `git log --author/--since/-- path` | postMessage ↔ engine | blame 可用 `vscode.commands.executeCommand('git.blame')`(待核实:原生是否可复用)或自建 `registerDocumentRangeCoverageProvider`(待核实 API 名) |
| **Branches(创建/检出/删除/rename/compare/merge/rebase)** | **TreeView** + `view/item/context` 右键 | `TreeDataProvider` + `menus: view/item/context` + `when: viewItem == branch\|remoteBranch` | TreeView 足够;每节点 `command` 触发检出,`contextValue` 控制菜单项可见性 |
| **Shelf(shelve/unshelve silently/with conflict)** | TreeView(Shelf 节点)+ engine 语义映射 | `TreeDataProvider` + engine 封装 git stash 派生语义 | IDEA Shelf 是私有概念,VS Code 无原生对应;用 git stash + patch 元数据模拟,`engine/git/` 负责语义转换 |
| **Stash(stash/apply/drop)** | TreeView(Stash 节点) | `TreeDataProvider` + engine 执行 `git stash list/apply/drop` | engine 解析 `git stash list` 为模型 |
| **Console(Git 操作输出)** | **OutputChannel** | `vscode.window.createOutputChannel('Sofia Git', { log: true })` | 用 log 模式 OutputChannel 获得 trace/debug/info 分级 |
| **Inspection(提交前代码检查)** | 命令触发 `vscode.execute...` 诊断 + agent 层 AI 审查 | `vscode.commands.executeCommand('vscode.executeDocumentDiagnostisProvider', uri)`(待核实精确 API) + `agent/review/` | 复用 VS Code 诊断能力 + 预留 AI 审查 |
| **Rollback/Revert/Ignore/Compare/Show History** | 命令 + context menu | `scm/resourceState/context` + 命令实现 | revert→engine `git checkout --`;ignore→写 `.gitignore`;history→打开 Log Webview 跳转 |
| **Diff(与分支/HEAD/本地)** | `vscode.diff` + `registerTextDocumentContentProvider` | 自定义 scheme(如 `sofiagit:HEAD/<ref>/<path>`)提供任意 ref 版本 | 单一 diff 入口,ref 解析下沉 engine |
| **StatusBar(当前分支/状态)** | StatusBarItem | `vscode.window.createStatusBarItem` | 复用原生 SCM 状态条或并行 |
| **状态持久化** | `globalState`/`workspaceState`/`SecretStorage` | `context.globalState`/`context.workspaceState`/`context.secrets` | globalState 存 UI 偏好;SecretStorage 存 LLM API key(AI 层)。证据:[VS Code API Reference](https://code.visualstudio.com/api/references/vscode-api) |

**映射表核心结论**:复用驱动原则下,**Local Changes 必须走 SCM API**(原生 Source Control 视图),把文件状态色、行级暂存、discard、diff 全部复用 VS Code 既有能力,避免重复造轮子;**Log 图与 Commit 窗口必须走 Webview**(TreeView 无法绘制 graph 连线、Input Box 无法承载复杂表单);**Branches/Shelf/Stash 走 TreeView**(结构性树数据,原生右键菜单足够)。

---

## 四、关键陷阱与规避

### 4.1 VS Code SCM 视图与原生 Source Control 的冲突(最高优先级)

- **陷阱**:VS Code 自带 Git 扩展已注册 `id: 'git'` 的 `SourceControl`。若本项目也提供 SCM provider,会出现两个并列的「源代码管理」条目,用户困惑;`gitDecoration.*` 主题色与 `scmProvider`/`scmResourceGroup` context key 易串。
- **规避**:
  1. 本项目 SCM 用**独立 `id`(如 `sofia-git`)**,通过 `when: scmProvider == sofia-git` 隔离菜单项,绝不硬绑 `git`。
  2. 产品定位上明确:本项目是「IDEA 风格增强层」,**默认不接管原生 Git**,而是作为并列的增强 SCM provider;若要替代,需提供 `configuration` 开关 `sofiaGit.replaceNativeGit`(关闭原生 git 扩展需 `extensions.json`,影响大,默认关闭)。
  3. 文件状态色复用 `ThemeColor('gitDecoration.modified')` 等**已存在的主题 token**,而非新造,保证深色模式一致。[Source Control API](https://code.visualstudio.com/api/extension-guides/scm-provider)

### 4.2 Webview 性能与内存

- **陷阱**:Webview 是独立 iframe 进程,Log 图与 Commit 窗口各开一个,内存占用高;大量 commit 数据 `postMessage` 传输(结构化克隆)会卡顿。
- **规避**:
  1. **数据分页/虚拟滚动**:Log 图前端对 > 500 条 commit 做虚拟列表;宿主侧只传当前可见窗口的 commit。
  2. **`retainContextWhenHidden`** 默认 `false`:视图隐藏时销毁 webview,按需重建;Commit 窗口可设 `true`(状态需保留),Log 设 `false`。
  3. **postMessage 改用增量更新**(diff-patch),非全量替换。
  4. 遵循 Matt Bierner(Webview 作者)的性能建议:避免在 webview 内做重计算,graph 渲染用轻量 SVG 而非重型框架。[Matt Bierner 博客](https://blog.mattbierner.com/vscode-webview-web-learnings/)

### 4.3 Activation 时机

- **陷阱**:扩展若用 `onStartupFinished` 或 `*` 全量激活,拖慢编辑器启动。
- **规避**:`activationEvents: []` 留空,依赖 `contributes` 自动推断:`onView:sofiaGit.localChanges`(打开视图时)、`onCommand:sofiaGit.*`(命令触发时)。**避免** `onStartupFinished`,除非确有必要(如需预先扫描仓库)。[Extension Anatomy](https://code.visualstudio.com/api/get-started/extension-anatomy)

### 4.4 engines.vscode 版本策略

- **陷阱**:`@types/vscode` 用最新版而 `engines.vscode` 设旧基线,导致用了新 API 但 CI 通过、用户装上后运行时 `TypeError`。
- **规避**:`@types/vscode` 的 `devDependencies` **严格对齐** `engines.vscode` 的最低版本(本项目 `^1.85.0` → `@types/vscode: 1.85.0`),让 `tsc` 在编译期拦截。[vscode-discussions #2437](https://github.com/microsoft/vscode-discussions/discussions/2437)

### 4.5 esbuild CJS 与 Vitest ESM 的测试架构割裂

- **陷阱**:把所有测试(含依赖 `vscode` API 的)塞进 Vitest,会因 ESM/CJS 不兼容爆炸。
- **规避**:严格分层——**Vitest 仅测 `engine/`(零 vscode 依赖)**,`@vscode/test-electron + Mocha` 测 `adapter/`(需 vscode API)。这是本骨架把 `engine/` 与 `adapter/` 物理分层的核心动因之一。[vitest-dev/vscode Issue #168](https://github.com/vitest-dev/vscode/issues/168)

### 4.6 `.vscodeignore` 与 vsce 包体积

- **规避**:`.vscodeignore` 必须排除 `src/`、`tests/`、`esbuild.js`、`tsconfig.json`、`.eslintrc` 等,只发布 `dist/` + `media/` + `package.json` + `README.md`,否则 `.vsix` 膨胀。

### 4.7 拼写/契约漂移(Single Source of Truth)

- **规避**:`shared/protocol.ts` 是 webview↔host 消息类型的唯一来源,前端与宿主均 import;杜绝在两侧各定义一份 message interface 造成 split-brain。

---

## 五、Next Best Action(主动导航建议)

1. **立即落地**:用 `pnpm` 初始化项目,复制 `esbuild-sample` 的 `esbuild.js` + `package.json` 脚本结构作为骨架零点(零试错,官方验证过)。
2. **Track 协同**:本骨架的 `engine/` 分层是为 Track2(git 引擎实现)与 Track4(AI agent)准备的并发协作边界——Track2 只动 `engine/`,Track4 只动 `agent/`,Track1(UI 描摹)对应 `adapter/scm|tree|webview` + `ui/`。
3. **风险前置验证**:优先做 PoC——(a) 一个最小 SCM provider(`createSourceControl` + 单 ResourceGroup)验证与原生 Git 共存;(b) 一个最小 WebviewView 验证 Log graph 自绘管线。两项验证通过后再全量铺开。
4. **待核实项跟进**:(a) `vscode.executeDocumentDiagnostisProvider` 的精确命令名(用于 Inspection);(b) 原生 `git.blame` 命令是否可直接复用于本项目;(c) IDEA Shelf 与 git stash 的语义映射细节需 Track1 输出 IDEA 侧行为描述后细化。

---

**核心参考来源**(均经核实可达):
- [Extension Anatomy](https://code.visualstudio.com/api/get-started/extension-anatomy)
- [Source Control API](https://code.visualstudio.com/api/extension-guides/scm-provider)
- [Webview API](https://code.visualstudio.com/api/extension-guides/webview)
- [Bundling Extensions](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)
- [Testing Extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- [Extension Manifest / engines.vscode](https://code.visualstudio.com/api/references/extension-manifest)
- [Contribution Points](https://code.visualstudio.com/api/references/contribution-points)
- [esbuild-sample esbuild.js](https://github.com/microsoft/vscode-extension-samples/blob/master/esbuild-sample/esbuild.js)
- [esbuild-sample package.json](https://github.com/microsoft/vscode-extension-samples/blob/master/esbuild-sample/package.json)
- [Vitest 与 @vscode/test-electron 兼容性 Issue #168](https://github.com/vitest-dev/vscode/issues/168)
- [engines.vscode 基线讨论 vscode-discussions #2437](https://github.com/microsoft/vscode-discussions/discussions/2437)
- [Matt Bierner: Webview 性能](https://blog.mattbierner.com/vscode-webview-web-learnings/)
- [vscode.SourceControlResourceState 类型](https://vshaxe.github.io/vscode-extern/vscode/SourceControlResourceState.html)
- [内置 git 扩展源码 microsoft/vscode/extensions/git](https://github.com/microsoft/vscode/tree/main/extensions/git)

> 注:本调研未写入任何文件(当前 Plan 模式)。完整 Markdown 产物已在上方输出,可直接交付主 Agent 整合或落盘为 `docs/.agents/track3-vscode-extension-blueprint.md`。
