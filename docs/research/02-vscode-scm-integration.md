# Track2 调研报告:VS Code SCM API 与 vscode.git 导出 API 集成路径

> 调研对象:在 VS Code 中实现统一 Git 变更管理面板(多分组列表 + 自绘 Commit 提交面板)的最佳集成路径。
> 证据基线:microsoft/vscode 源码(`extensions/git/src/api/git.d.ts`、`api1.ts`、`vscode.d.ts`)、官方 SCM provider 指南、GitHub Issue 追踪记录、同类扩展(GitLens、vscode-pull-request-github)实践。
> 检索时间:2026 年 6 月。所有关键事实附 GitHub 文件路径或官方文档 URL;存疑项标注「待核实」。

---

## 0. 核心结论(执行摘要)

| 决策项 | 结论 |
|---|---|
| **推荐路径** | **路径 B(纯消费 vscode.git 导出 API + 自建 TreeView/WebviewView 渲染自绘 UI),原生 Source Control 视图保持不动** |
| **changelist 模型** | VS Code SCM 是「分组(group)」模型,不是 IDEA 的「多 changelist」。多 changelist 用**自建 TreeView** 表达最忠实;若想借用原生视图,可用「每个 changelist 一个 `SourceControlResourceGroup`」近似但语义有损 |
| **Commit 窗口 UI** | 放在 **Secondary Side Bar 的 WebviewView**(自建视图容器),自带 Commit/Shelf/Stash 标签页 + Commit Message 编辑器;**不依赖也不替代**原生 `SourceControlInputBox`(稳定字段太弱,且 `SourceControlInputBoxValueProvider` 已被官方删除) |
| **提交图(Log)** | 原生 Source Control Graph 的 `scmHistoryProvider` **仍是 proposed API**(截至 2025-05 无 stable 时间表),不能稳定复用。Log 提交图须自建 TreeView + 消费 `Repository.log()` |
| **git 操作底座** | 全部复用 vscode.git 导出的 `API`(`commit/add/revert/diff/blame/log/stash/branch/merge/rebase`),不自调 git CLI(循证:GitHub PR 扩展即此模式) |

**一句话理由**:VS Code 原生 SCM API 的设计哲学是「provider 负责填数据 + 框架负责渲染统一 UI」,与 IDEA「插件完全自绘工具窗口」相反。强行注册独立 SCM Provider(A/C)会与原生 git 视图**双胞胎冲突**,且无法表达 IDEA 的多 changelist + Commit 对话框这种「自绘」需求;而纯消费 git API + 自绘视图(B)既能拿到稳定的 git 能力,又拥有 100% 的 UI 自由度,与原生视图零冲突,符合「复用驱动 + 正交分解」。

---

## 1. SCM API 能力地图(稳定 API)

> 来源:[官方 SCM provider 指南](https://code.visualstudio.com/api/extension-guides/scm-provider)、[VS Code API 参考](https://code.visualstudio.com/api/references/vscode-api)、`src/vscode-dts/vscode.d.ts`。下列为**稳定(public/stable)**能力,proposed 项单列。

### 1.1 SourceControl(顶层 provider 句柄)

由 `vscode.scm.createSourceControl(id, label, rootUri?)` 创建。稳定字段(来源:[vscode.d.ts](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts) `export interface SourceControl`):

| 成员 | 类型 | 能力 | IDEA 对应 |
|---|---|---|---|
| `id` / `label` | `readonly string` | provider 标识与显示名 | — |
| `rootUri` | `readonly Uri \| undefined` | 仓库根 | 仓库根 |
| `inputBox` | `SourceControlInputBox` | **唯一的**提交消息输入框 | Commit Message 区 |
| `count` | `number \| undefined` | 在 provider 标题上显示的徽标数字 | Changes 计数 |
| `commitTemplate` | `string \| undefined` | 预填入 inputBox 的模板 | Commit Message Template |
| `acceptInputCommand` | `Command \| undefined` | 用户按 Ctrl/Cmd+Enter 提交时触发的命令 | Commit 按钮 |
| `statusBarCommands` | `Command[]` | 状态栏下拉命令 | — |
| `quickDiffProvider` | `QuickDiffProvider \| undefined` | 提供 gutter quick diff | 编辑器内联 diff 标记 |
| `createResourceGroup(id, label)` | → `SourceControlResourceGroup` | 创建分组 | changelist 雏形 |
| `selected` | `readonly boolean` | 是否为当前选中的 provider | active 仓库 |

**硬限制**:
- **每个 SourceControl 只有一个 `inputBox`**(单 Commit Message),无法表达「多 changelist 各自有独立 message」(IDEA 的 Default changelist 才有 message,其他可独立)。来源:[官方指南 SCM Input Box 段](https://code.visualstudio.com/api/extension-guides/scm-provider#scm-input-box)。
- `SourceControl.contextValue`(用于 `when` 子句精细控制菜单)是 **proposed API**(`scmProviderOptions`,issue [#254910](https://github.com/microsoft/vscode/issues/254910))。来源:[vscode.proposed.scmProviderOptions.d.ts](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.scmProviderOptions.d.ts)。

### 1.2 SourceControlResourceGroup(分组 = changelist 的近似)

```
createResourceGroup(id, label) → { id, label, resourceStates, hideWhenEmpty, ... dispose() }
```

- `resourceStates: SourceControlResourceState[]` — 你**全量覆盖**这个数组来更新分组内容(push 模型,非增量)。
- `hideWhenEmpty: boolean` — 空分组自动隐藏。
- 分组在视图里**默认可折叠**(VS Code 1.18+ SCM 视图即树状)。来源:[官方指南 Source Control Model 段](https://code.visualstudio.com/api/extension-guides/scm-provider#source-control-model)。

**能否多 group 折叠?** 能。一个 SourceControl 下 `createResourceGroup` 可调用多次,每个 group 独立折叠。git 扩展自己就建了 `merge` / `index` / `workingTree` / `untracked` 四个 group。来源:`extensions/git/src/repository.ts`(git.d.ts 的 `RepositoryState` 暴露了 `mergeChanges/indexChanges/workingTreeChanges/untrackedChanges`,对应这四个 group)。

**changelist 表达力的硬限制**:
- group 是「只读展示容器」,**没有 group 级别的 commit message、没有 group 级别的 active 概念**。IDEA 的 active changelist(active 时新增文件自动落入)在原生 SCM 里无对应物。
- group 之间**无法跨 group 拖拽移动文件**(move changes)——SCM 视图不支持跨 group DnD,只能靠 `scm/resourceState/context` 菜单命令实现。

### 1.3 SourceControlResourceState(单个文件条目)

稳定字段(来源:[官方指南](https://code.visualstudio.com/api/extension-guides/scm-provider#source-control-view) + [Haxe externs 镜像](https://vshaxe.github.io/vscode-extern/vscode/SourceControlResourceState.html)):

| 成员 | 能力 |
|---|---|
| `resourceUri: Uri` | 文件路径(渲染主标签) |
| `command?: Command` | **单击**该文件时的命令(通常打开 diff) |
| `decorations?: SourceControlResourceDecorations` | 状态色/图标/删除线等 |
| `multiDiffEditorOriginalUri?` / `multiDiffEditorModifiedUri?` | 接入 multi-diff 编辑器(proposed `scmMultiDiffSource`,见下) |

### 1.4 SourceControlResourceDecorations(状态色 M/A/D/U...)

稳定字段(来源:[Haxe externs](https://vshaxe.github.io/vscode-extern/vscode/SourceControlResourceDecorations.html) + 官方指南):

| 成员 | 对应 IDEA 状态色 |
|---|---|
| `strikeThrough?: boolean` | 删除(D) |
| `faded?: boolean` | 未跟踪/弱化(U) |
| `tooltip?: string` | 悬停提示 |
| `letter?: string` | 单字母角标(M/A/D/R/C/U) |
| `color?: ThemeColor` | 状态色(如 `gitDecoration.modifiedResourceForeground`) |
| `iconPath?: string \| Uri \| {light, dark}` | 自定义图标 |
| `source?: string` | 来源标注 |

> M/A/D/U/Renamed/Copied 等文件状态色完全可由 `letter` + `color` 组合实现(git 扩展就是这么做的,见其 `Resource` 类的 decorations 计算)。

### 1.5 QuickDiff(编辑器 gutter 内联 diff)

```
quickDiffProvider?: QuickDiffProvider  // provideOriginalResource(uri) → 原始资源 Uri
```
配合 `registerTextDocumentContentProvider` 提供原始内容。来源:[官方指南 Quick Diff 段](https://code.visualstudio.com/api/extension-guides/scm-provider#quick-diff)。能力完备,可直接复用。

### 1.6 SourceControlInputBox(提交消息框)— 关键硬限制

**稳定字段仅有**:`value: string`、`visible: boolean`、`placeholder: string`。来源:[官方指南 SCM Input Box](https://code.visualstudio.com/api/extension-guides/scm-provider#scm-input-box) + WebSearch 交叉确认。

**致命限制(循证)**:曾用于「按 provider 动态提供 inputBox 值/校验」的 `SourceControlInputBoxValueProvider` 提案,**已被官方删除**(PR [microsoft/vscode#199778](https://github.com/microsoft/vscode/issues/199778),issue [#195474](https://github.com/microsoft/vscode/issues/195474) 标题由 `SourceControlInputBoxValueProvider API proposal` 改为 `scm/inputBox menu contribution`)。结论:**无法在原生 inputBox 上做 Conventional Commits 实时校验、无法嵌多行模板编辑器、无法加自定义按钮**。

> 这一硬限制直接决定了:IDEA 的 Commit Message 多行编辑区(模板/校验/Amend/Author)无法落在原生 inputBox 上 → 必须自建 WebviewView(见第 5 节)。

### 1.7 SCM 菜单贡献点(自定义二级菜单/inline 按钮)

来源:[官方指南](https://code.visualstudio.com/api/extension-guides/scm-provider#source-control-view)。**全部稳定**,且能力足够支撑文件右键菜单:

| 菜单 id | 作用位置 | 可放 `inline`(行内按钮) |
|---|---|---|
| `scm/title` | provider 标题栏 | ✅ navigation 组行内 |
| `scm/resourceGroup/context` | **分组(changelist)右键** | ✅ |
| `scm/resourceState/context` | **文件右键** | ✅ |
| `scm/resourceFolder/context` | 文件夹节点右键 | ✅ |
| `scm/repository` | Repositories 视图每项 | ✅ |
| `scm/sourceControl` | Repositories 视图右键 | ❌ |
| `scm/change/title` | 内联 diff 编辑器标题栏 | ❌ |

`when` 子句可用 `scmProvider` / `scmResourceGroup` context key 精细控制。来源:官方指南示例 `when: "scmProvider == git && scmResourceGroup == merge"`。

> 结论:**每个文件的二级菜单、行内 inline 按钮、分组级菜单都能自定义**——这部分原生 SCM 完全够用。

### 1.8 提交图(SourceControlHistoryItem)— proposed,不可稳定复用

`SourceControlHistoryItem` / `SourceControlHistoryItemChange` / `scmHistoryProvider` **至今仍是 proposed API**。VS Code 团队成员 lszomoru 2025-05-13 在 issue [#185269](https://github.com/microsoft/vscode/issues/185269) 明确:「计划 finalize 但无时间表」。定义文件:[vscode.proposed.scmHistoryProvider.d.ts](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.scmHistoryProvider.d.ts)。

> 第三方扩展在 Marketplace 发布时使用 proposed API 受限(需特批)。因此 **Log 可视化提交图不能依赖原生 Source Control Graph,必须自建 TreeView**。

### 1.9 Multi-Diff 编辑器 — proposed

`scmMultiDiffSource`(多文件并排 diff 审查)是 proposed,跟踪 issue [#179000](https://github.com/microsoft/vscode/issues/179000),`vscode.changes` 命令标注「experimental, subject to change」。「提交前多文件 diff 预览」短期须自建 Webview 或逐文件 diff。

---

## 2. vscode.git 扩展导出 API(已读源码确认)

> 来源:`extensions/git/src/api/git.d.ts`(完整签名)+ `extensions/git/src/api/api1.ts`(实现)。两文件已逐行读取,下述为源码直接摘录的事实。

### 2.1 版本机制与稳定性

```ts
export interface GitExtension {
  readonly enabled: boolean;
  readonly onDidChangeEnablement: Event<boolean>;
  getAPI(version: 1): API;   // 唯一版本入口,version 必须传字面量 1
}
```
来源:[git.d.ts `GitExtension`](https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts)。

- **版本机制**:`getAPI(1)` 是唯一导出形态,以字面量 `1` 锁定主版本;若 git 扩展 disabled 会抛错,需监听 `onDidChangeEnablement`。
- **稳定性**:**这是稳定公开的扩展导出 API**,不是 proposed。第三方扩展经 Marketplace 发布无需特批。来源:官方 [extensions/git/README.md](https://github.com/microsoft/vscode/blob/main/extensions/git/README.md) 明示「The Git extension exposes an API, reachable by any other extension」。
- **untrusted workspace**:git 扩展在 untrusted workspace 下功能受限(`supportUntrusted: false`),消费方需在 trusted 环境使用。来源:git 扩展 package.json(待核实具体 policy 字段,行为可观察)。

### 2.2 消费声明方式(循证:GitHub PR 扩展即此模式)

**package.json**:
```json
{ "extensionDependencies": ["vscode.git"] }
```
> `extensionDependencies` 声明运行时依赖,保证激活顺序与可用性。来源:[Extension Manifest 参考](https://code.visualstudio.com/api/references/extension-manifest)。**注意**:不需要 `enabledApiProposals`,因为这不是 proposed API。

**TypeScript 类型**:官方要求「把 `extensions/git/src/api/git.d.ts` 复制进你的扩展源码」。来源:官方 git README。

**运行时获取**(标准模式,来源:[Stack Overflow 官方回答](https://stackoverflow.com/questions/59442180/vs-code-git-extension-api) + [dev.to 实操](https://dev.to/bwfiq/live-syncing-to-a-git-repository-with-a-vs-code-extension-3p8m)):
```ts
const gitExt = vscode.extensions.getExtension<GitExtension>('vscode.git')!;
await gitExt.activate();              // 防御性激活
const api = gitExt.exports.getAPI(1); // → API
```

### 2.3 `API` 表面能力(源码确认)

来源:[git.d.ts `API`](https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts) + api1.ts 实现。

| 能力 | API | 备注 |
|---|---|---|
| 仓库发现 | `api.repositories: Repository[]`、`onDidOpenRepository`、`onDidCloseRepository`、`getRepository(uri)`、`getRepositoryRoot(uri)` | 多仓库支持完备 |
| 状态生命周期 | `api.state: 'uninitialized'\|'initialized'` + `onDidChangeState` | 初始化前 `repositories` 为空 |
| 发布事件 | `onDidPublish` | Commit & Push 完成回调 |

### 2.4 `Repository` 能力(源码逐项确认)— 这是最关键的能力底座

来源:[git.d.ts `Repository`](https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts)。

| IDEA 功能域 | Repository 方法 | 覆盖度 |
|---|---|---|
| **变更模型** | `state.indexChanges` / `workingTreeChanges` / `mergeChanges` / `untrackedChanges` + `Status` 枚举(INDEX_MODIFIED/ADDED/DELETED/RENAMED/COPIED + MODIFIED/DELETED/UNTRACKED/IGNORED/INTENT_TO_ADD/INTENT_TO_RENAME/TYPE_CHANGED + 冲突 7 种 ADDED_BY_US...BOTH_MODIFIED) | ✅ 完全覆盖 IDEA 的 M/A/D/U/Renamed/Copied + 冲突 |
| **stage/unstage** | `add(paths)`、`revert(paths)`(unstage,IDEA 语义)、`clean(paths)`、`restore(paths, {staged, ref})` | ✅ |
| **commit** | `commit(message, opts?: {all, amend, signoff, signCommit, empty, noVerify, useEditor})` | ✅ 含 amend/signoff/no-verify |
| **diff** | `diffWithHEAD`、`diffWith(ref)`、`diffIndexWithHEAD`、`diffBetween(ref1,ref2)`、`diffBetweenPatch`、`diffBetweenWithStats` | ✅ 覆盖与分支/HEAD/本地比较 |
| **blame** | `blame(path)` → string | ✅ Show History/Annotate |
| **log** | `log(opts?: {maxEntries, path, range, author, grep, refNames, sortByAuthorDate, shortStats})` → `Commit[]` | ✅ 含按作者/路径/消息过滤,Commit 带 hash/message/parents/authorDate/authorName/shortStat |
| **branch** | `createBranch(name, checkout, ref?)`、`deleteBranch`、`getBranch`、`getBranches(query)`、`setBranchUpstream` | ✅ 创建/检出/删除/重命名(重命名无直接 API,待核实)/比较 |
| **merge/rebase** | `merge(ref)`、`mergeAbort()`、`rebase(branch)` | ✅ |
| **stash** | `createStash({message, includeUntracked, staged})`、`applyStash(index)`、`popStash(index)`、`dropStash(index)` | ✅ stash/apply/drop(pop=apply+drop) |
| **tag** | `tag(name, message, ref?)`、`deleteTag` | ✅ |
| **fetch/pull/push** | `fetch(options)`、`pull(unshallow?)`、`push(remote, branch, setUpstream, force)` + `ForcePushMode` 枚举 | ✅ push 含 force-with-lease |
| **checkout** | `checkout(treeish)` | ✅ |
| **commit 对象** | `getCommit(ref)`、`show(ref, path)`、`buffer(ref, path)`、`getObjectDetails` | ✅ |
| **worktree** | `createWorktree`、`deleteWorktree` | ✅ |
| **migrateChanges** | `migrateChanges(sourceRepoPath, {confirmation, deleteFromSource, untracked})` | ⚠️ 源码有,IDEA 对应「Move Changes to Another Changelist/Repo」语义待核实 |

**事件**:`onDidCommit`、`onDidCheckout`、`state.onDidChange`(状态变更)、`ui.onDidChangeSelection`(provider 选中变化)。来源:git.d.ts `Repository` / `RepositoryState` / `RepositoryUIState`。

**InputBox 桥接**:`repository.inputBox`(只暴露 `value` get/set)是原生 `SourceControlInputBox` 的薄包装。来源:api1.ts `ApiInputBox`:
```ts
class ApiInputBox implements InputBox {
  #inputBox: SourceControlInputBox;
  set value(v) { this.#inputBox.value = v; }
  get value() { return this.#inputBox.value; }
}
```
即:**通过 git API 只能读写原生 inputBox 的 value,无法增强其 UI**——再次印证须自建 Commit 编辑器。

### 2.5 可注册的扩展点(API.register*)

git API 还允许第三方**注入**能力而非仅消费:`registerPostCommitCommandsProvider`、`registerBranchProtectionProvider`、`registerCredentialsProvider`、`registerRemoteSourceProvider`、`registerPushErrorHandler`、`registerSourceControlHistoryItemDetailsProvider`(提交图 hover/头像/链接增强,注意这是「增强原生 Graph」而非「自建 Graph」)。来源:git.d.ts `API`。

---

## 3. 集成路径对比(决策表)

| 维度 | A. 注册独立 SCM Provider(包装 git CLI) | **B. 纯消费 vscode.git API + 自建 TreeView/WebviewView(推荐)** | C. 注册 SCM Provider + 复用 vscode.git 数据源 |
|---|---|---|---|
| **git 操作实现** | 自调 `child_process` git(或包装 `git.path`) | **全部复用 `api.getAPI(1)` 的 Repository 方法** | 复用 git API 读数据,但 stage/commit 走自己的 SourceControl |
| **与原生 Source Control 视图关系** | **双胞胎冲突**:活动栏会出现两个 Git provider,用户混淆;`extensionDependencies: ["vscode.git"]` 后两者并存 | **零冲突**:原生 git 视图照常,我们的 UI 在**独立视图容器**(Secondary Side Bar) | 双胞胎冲突(同 A) |
| **多 changelist 表达** | 多 `SourceControlResourceGroup` 近似(语义有损:无 group 级 message/active) | **自建 TreeView,每个 changelist 一个根节点**,可挂独立 message/active 标记,语义无损 | 同 A,有损 |
| **Commit 窗口(模板/校验/Amend/Author)** | 受限于原生 inputBox(单行,无校验,Provider 已删)→ **无法实现** | **自建 WebviewView 编辑器,100% 自由**(多行/模板/Conventional Commits 校验/Amend/Author) | 同 A,无法实现 |
| **Log 提交图** | 原生 Graph 是 proposed,不可稳定用 → 仍需自建 | 自建 TreeView + `Repository.log()`(稳定) | 自建(同 B) |
| **文件右键菜单/状态色** | 原生 SCM 菜单贡献点(强) | 自建 TreeView 的 `view/item/context`(同样强,且更可控) | 原生 SCM 菜单(强) |
| **性能** | 自管 git 进程,需自行处理状态轮询/缓存 | **复用 git 扩展已优化的状态机**(增量 status、diff 缓存、操作队列),性能最优 | 双重状态管理,冗余 |
| **迁移/维护成本** | 高:重写 git 状态机、diff 解析、错误码映射 | **中:需自绘 UI,但 git 逻辑全复用** | 最高:既要管 SCM provider 契约又要桥接 git API |
| **与 AI Agent 未来扩展(提交信息生成/审查)耦合度** | 自管状态,AI 集成需额外适配 | **天然契合**:AI 可直接读 `Repository.state.*Changes` + 调 `commit()` | 冗余 |
| **循证先例** | SVN 扩展(非 git 场景才合理) | **GitLens、vscode-pull-request-github 均为消费 git API 模式** | 无知名先例 |

### 推荐路径:B(纯消费 vscode.git API + 自建视图)

**理由(对应 AGENTS.md 准则)**:

1. **复用驱动(拿来主义)**:git 状态机、diff/blame/log/stash/branch/merge/rebase 全部已由 vscode.git 团队(Lszomoru 等)实现并优化,重造=重复造轮子,违背「Compose over Reinvent」。GitHub 官方的 PR 扩展(microsoft/vscode-pull-request-github)即采用此模式,源码含 `gitExtensionIntegration.ts`。来源:[vscode-pull-request-github 仓库](https://github.com/microsoft/vscode-pull-request-github)。

2. **正交分解(Engine/Adapter/Agent/UI 分层)**:
   - **Engine**:vscode.git API(不可变底座)
   - **Adapter**:我们封装一层 `GitRepositoryAdapter`,把 `Repository` 适配成领域模型(Changelist/FileChange)
   - **UI**:自建 TreeView(changes)+ WebviewView(commit dialog)+ TreeView(log/branches/stash)
   - **Agent**(未来):AI 层只依赖 Adapter 的领域模型,不碰 vscode API

3. **单一事实源**:git 真实状态只在 vscode.git 维护一份,我们的 Adapter 是只读视图 + 委托写操作,杜绝 Split-Brain(若走 A/C,两套状态会断裂)。

4. **系统完整性(涟漪效应预判)**:路径 A/C 会与原生 git 视图产生「谁是 source of truth」的竞争(用户在原生视图 stage,我们的视图不同步);路径 B 不接管原生视图,只做增量 UI,涟漪最小。

5. **规避 proposed API 陷阱**:B 不依赖任何 proposed API(scmHistoryProvider/scmMultiDiffSource/scmProviderOptions/scmInputBoxValueProvider 全避开),可在 Marketplace 无障碍发布。

---

## 4. changelist 模型映射方案(路径 B 下的落地)

### 4.1 概念映射

| IDEA 概念 | VS Code 落地(路径 B) | 实现 |
|---|---|---|
| Changelist(多组) | 自建 TreeView 的**一级节点** | `vscode.window.createTreeView('sofia.changes', {...})`,每个 changelist 一个 `TreeItem`(collapsible) |
| Active changelist | 一级节点带 `description=active` + 图标徽标;新增文件默认归入此节点 | Adapter 维护 `activeChangelistId`,TreeView 高亮 |
| Changelist 内文件 | 一级节点下的**叶子节点** | `TreeItem` with `resourceUri` + `iconPath`(状态色)+ `description`(M/A/D) |
| 文件状态色 M/A/D/U/R/C | 叶子节点的 `iconPath`(ThemeIcon + ThemeColor)或 `description` 文字 | 复用 git 扩展同款 `gitDecoration.*Foreground` ThemeColor |
| Move changes(跨 changelist 移文件) | 叶子节点右键 `Move to Changelist...` 命令 | Adapter 维护内存 changelist→files 映射;stage/commit 时按 changelist 过滤 `add(paths)` |

### 4.2 与 git 的语义桥接(关键设计)

git 本身**没有 changelist** 概念,只有 stage(index)。IDEA 的 changelist 是「工作区变更的逻辑分组」。映射策略:

- **物理层**:所有变更仍来自 `Repository.state.workingTreeChanges`(单一事实源)。
- **逻辑层**:Adapter 维护一个**本地 changelist 分配表**(`Map<filePath, changelistId>`),持久化到 workspace state(`context.workspaceState`)或 `.idea` 风格本地文件。
- **提交语义**:「Commit 某 changelist」= `add(该 changelist 的 paths)` + `commit(msg)` + (可选)保留其余未 stage。这即对应「selective commit(选择性提交)」语义。
- **Default changelist**:即 active changelist,未显式分配的变更自动落入。

> 注意:此设计下,changelist 是**纯客户端逻辑分组**,不写 git 元数据(IDEA 的 changelist 也仅存于 `.idea/workspace.xml`,同理)。这与 git 的 stage 是两套正交机制,需在 UI 上明确区分(可提供「stage = 临时索引」「changelist = 持久分组」的认知锚点)。

### 4.3 备选(若要借用原生 SCM 视图)

放弃 TreeView,改为**注册一个自己的 SourceControl + 每个 changelist 一个 ResourceGroup**。代价:无 group 级 message、无 active 概念、与原生 git 视图双胞胎。**不推荐**,仅作为「快速 MVP」降级方案。

---

## 5. Commit 窗口 UI 落地(路径 B 下的落地)

### 5.1 容器选择:Secondary Side Bar 的 WebviewView + 自定义视图容器

**package.json 贡献**(来源:[viewsContainers 贡献点](https://code.visualstudio.com/api/references/contribution-points#contributes.viewsContainers)):
```json
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [{ "id": "sofia-git", "title": "SOFIA Git", "icon": "..." }]
    },
    "views": {
      "sofia-git": [
        { "id": "sofia.changes",  "name": "Changes",  "type": "tree" },
        { "id": "sofia.commit",   "name": "Commit",   "type": "webview" },
        { "id": "sofia.log",      "name": "Log",      "type": "tree" },
        { "id": "sofia.shelf",    "name": "Shelf",    "type": "tree" },
        { "id": "sofia.stash",    "name": "Stash",    "type": "tree" }
      ]
    }
  }
}
```

> GitLens 正是此模式:在 Source Control 活动栏挂自定义视图(来源:[gitkraken/vscode-gitlens issue #213](https://github.com/gitkraken/vscode-gitlens/issues/213) 讨论其视图置于 SCM 面板)。

### 5.2 顶部 Commit/Shelf/Stash 标签页 → VS Code 表达

两种实现,择一:

- **方案 1(推荐):平铺视图节点**。上图 `sofia-git` 容器下并列 Changes/Commit/Log/Shelf/Stash 五个 view,用户点击切换(等价标签页)。
- **方案 2:单 WebviewView 内自绘 Tabs**。一个 `sofia.main` webview 内用前端框架渲染自绘 Tab 栏 + 各面板内容。自由度最高但失去原生 a11y/快捷键集成。

### 5.3 Commit Message 编辑器(替代原生 inputBox)

- 用 `WebviewView` 渲染一个**多行 Monaco-like 编辑器**(可用 `<textarea>` + 自绘,或内嵌 Monaco via webview)。
- 能力覆盖:模板注入、Conventional Commits 实时校验(前端逻辑)、Amend 开关、Author 覆盖、sign-off/fixup 选项。
- 提交动作:webview 通过 `acquireVsCodeApi().postMessage` 把 message + opts 发回扩展,扩展调 `repository.commit(message, opts)`(opts 映射 `amend/signoff/signCommit/noVerify`)。
- **与原生 inputBox 的协同**:可选「单向同步」——把自建编辑器的 value 回写 `repository.inputBox.value`,让原生视图也能看到(反之亦然,监听 inputBox 变化)。但因 inputBox 单行且无校验,这只是兼容性糖,主交互在自建编辑器。

### 5.4 底部 Commit / Commit and Push 按钮

WebviewView 底部固定区:
- **Commit** → `repository.commit(msg, opts)`
- **Commit and Push** → `repository.commit(msg, opts)` 成功后 `repository.push(remote, branch, false, force)`;或监听 `api.onDidPublish`
- 提交前 Inspection(IDEA 的 pre-commit code inspection):复用 VS Code 诊断——`vscode.languages.getDiagnostics()` 对所选文件取 diagnostics 作为「问题」提示;可选触发 `vscode.executeCodeActionProvider` 预跑 reformat/optimize imports。

### 5.5 右侧 diff 预览

- **方案 1(推荐,零成本)**:单击 Changes 树叶节点 → `vscode.commands.executeCommand('vscode.diff', originalUri, modifiedUri, title)`,originalUri 用 `api.toGitUri(uri, 'HEAD')`(git 扩展提供的 git scheme 资源,自动取 HEAD 版本)。来源:git.d.ts `API.toGitUri`。
- **方案 2**:Webview 内嵌 diff 视图(自绘,工作量大,不推荐除非要并排多文件)。

### 5.6 Shelf(IDEA 独有,git 无原生对应)

git 的 stash ≠ IDEA 的 shelve。IDEA shelve 是 patch 存储于 `.idea/shelf/`。落地:
- **近似用 stash**:`createStash({message, includeUntracked, staged})` 存、`applyStash/popStash` 取、`dropStash` 删。语义接近「shelve silently / unshelve」。
- **完整 Shelf 实现(patch 持久化)**:自实现 patch 序列化(`git diff > patch` via `repository.diffBetweenPatch`),存到扩展 storage;apply 用 `repository.apply(patch, {threeWay})` 处理冲突(unshelve with conflict)。来源:git.d.ts `apply(patch, {allowEmpty, reverse, threeWay})` + `diffBetweenPatch`。
- 推荐 MVP 用 stash 近似,v2 再做完整 Shelf。

---

## 6. 风险与待核实项

| 项 | 状态 | 说明 |
|---|---|---|
| `scmHistoryProvider`(提交图)stable | proposed,无时间表 | 来源:issue [#185269](https://github.com/microsoft/vscode/issues/185269)(lszomoru 2025-05)。→ 自建 Log TreeView |
| `scmMultiDiffSource`(多文件 diff) | proposed,experimental | 来源:issue [#179000](https://github.com/microsoft/vscode/issues/179000)。→ 单文件 diff 或自建 webview |
| `scmProviderOptions`(SourceControl.contextValue) | proposed | 来源:[vscode.proposed.scmProviderOptions.d.ts](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.scmProviderOptions.d.ts)。路径 B 不需要 |
| `SourceControlInputBoxValueProvider` | **已删除** | 来源:PR microsoft/vscode#199778 / issue [#195474](https://github.com/microsoft/vscode/issues/195474)。→ 不可用,自建编辑器 |
| `Repository` 分支**重命名** API | 待核实 | git.d.ts 未见 `renameBranch`;可能需 `branch -m` via 暂无暴露,或用 `setBranchUpstream` 间接。落地时需验证,必要时降级为「删除+创建+checkout」 |
| `migrateChanges` 的 IDEA 语义对应 | 待核实 | api1.ts 有实现,但「move changes 跨仓库」与 IDEA「跨 changelist」语义不同,需在设计文档澄清 |
| untrusted workspace 下 git API 行为 | 待核实 | git 扩展 `supportUntrusted` 策略需查其 package.json 确认具体限制 |
| vscode.git API 跨版本兼容 | 稳定(主版本 1) | `getAPI(1)` 锁主版本;次版本新增字段对消费方透明。建议在 Adapter 层做防御性可选链 |

---

## 7. 关键来源清单(IEEE 风格可溯源)

**源码(GitHub,microsoft/vscode)**:
- [extensions/git/src/api/git.d.ts](https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts) — GitExtension/API/Repository 全部签名(已逐行读取)
- [extensions/git/src/api/api1.ts](https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/api1.ts) — API 实现,ApiInputBox 桥接(已逐行读取)
- [extensions/git/README.md](https://github.com/microsoft/vscode/blob/main/extensions/git/README.md) — 导出 API 公开声明
- [src/vscode-dts/vscode.d.ts](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts) — 稳定 SCM 接口(Note:经 zread 获取为截断版,稳定字段以官方指南+Haxe externs 镜像交叉确认)
- [src/vscode-dts/vscode.proposed.scmHistoryProvider.d.ts](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.scmHistoryProvider.d.ts) — 提交图 proposed
- [src/vscode-dts/vscode.proposed.scmProviderOptions.d.ts](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.scmProviderOptions.d.ts) — SourceControl.contextValue proposed

**官方文档(code.visualstudio.com)**:
- [Source Control API – Extension Guides](https://code.visualstudio.com/api/extension-guides/scm-provider) — SCM provider 权威指南(已读全文)
- [VS Code API Reference](https://code.visualstudio.com/api/references/vscode-api) — 稳定 API 索引
- [Extension Manifest – extensionDependencies](https://code.visualstudio.com/api/references/extension-manifest)
- [Contribution Points – viewsContainers/views](https://code.visualstudio.com/api/references/contribution-points#contributes.viewsContainers)
- [Using Proposed API](https://code.visualstudio.com/api/advanced-topics/using-proposed-api)

**Issue 追踪(proposed API 状态证据)**:
- [microsoft/vscode#185269 – history provider proposed API(2025-05 仍无 stable 时间表)](https://github.com/microsoft/vscode/issues/185269)
- [microsoft/vscode#195474 – scm/inputBox menu(InputBoxValueProvider 已删除)](https://github.com/microsoft/vscode/issues/195474)
- [microsoft/vscode#199778 – delete scmInputBoxValueProvider proposal](https://github.com/microsoft/vscode/issues/199778)
- [microsoft/vscode#179000 – Multi File Diff Editor(experimental)](https://github.com/microsoft/vscode/issues/179000)
- [microsoft/vscode#254910 – scmProviderOptions(contextValue proposed)](https://github.com/microsoft/vscode/issues/254910)

**同类扩展先例(消费 git API 模式)**:
- [microsoft/vscode-pull-request-github](https://github.com/microsoft/vscode-pull-request-github)(含 `src/gitExtensionIntegration.ts`)
- [gitkraken/vscode-gitlens](https://github.com/gitkraken/vscode-gitlens)(issue [#213](https://github.com/gitkraken/vscode-gitlens/issues/213) 讨论视图容器挂载)
- [microsoft/vscode-extension-samples – source-control-sample](https://github.com/microsoft/vscode-extension-samples/blob/main/source-control-sample/README.md)

**实操参考**: [Stack Overflow – VS Code Git Extension API](https://stackoverflow.com/questions/59442180/vs-code-git-extension-api)、[dev.to – Live Syncing via Git API](https://dev.to/bwfiq/live-syncing-to-a-git-repository-with-a-vs-code-extension-3p8m)、[Haxe externs – SourceControlResourceState](https://vshaxe.github.io/vscode-extern/vscode/SourceControlResourceState.html) / [SourceControlResourceDecorations](https://vshaxe.github.io/vscode-extern/vscode/SourceControlResourceDecorations.html)

---

## 8. 下一步最佳行动建议(Next Best Action)

1. **固化决策**:本报告推荐路径 B,建议在 `.temp/` 输出一份《集成路径决策 ADR》,锁定「消费 vscode.git API + 自建视图容器」。
2. **产出 Adapter 层接口设计**:基于 git.d.ts 的 `Repository`/`RepositoryState`/`Change`/`Status`,定义 `GitRepositoryAdapter`(领域模型 Changelist/FileChange/Commit),作为 Engine 与 UI/Agent 的正交边界。
3. **PoC 验证关键风险点**:(a) `extensionDependencies: ["vscode.git"]` + `getAPI(1)` 拿到 `Repository` 并读取 `workingTreeChanges`;(b) 自建 TreeView 渲染 changelist;(c) WebviewView Commit 编辑器 postMessage → `repository.commit()`。三项跑通即可消除主要技术不确定性。
4. **v1 范围裁剪(YAGNI)**:Shelf 先用 stash 近似;Log 先用 `Repository.log()` 自建 TreeView;多文件 diff 先单文件 `vscode.diff`。复杂项排入 v2。
5. **并行 Track**:本报告聚焦集成路径;建议并行启动「Git 变更管理面板 UI 细节调研」(各面板交互/快捷键/状态机,参考 IDEA 等成熟实现)与「AI Agent 提交信息生成/代码审查」调研,三者可在 Adapter 层汇合。


############################################################
