# 变更文件目录树切换（Group by Directory）

> Commit 视图活动 Changelist 的文件列表、Log 视图选中提交的「Changed Files」列表，均支持在**平铺列表**与**按目录分组的树形**之间切换（对齐 IntelliJ / VS Code SCM）。默认平铺，树形为可选切换，偏好按视图各自记忆。

## 设计：host 算树、webview 渲染（单一事实源）

Webview 使用内联 `<script>` 字符串，无法 `import` engine TS。为避免同一「路径→树」逻辑两处实现（Split-Brain），沿用提交图布局的成熟范式（`graph-layout` 于 host 计算、随 `GraphRowVM.layout` 下发）：

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/architecture/features/file-list-group-by-directory-dataflow.dark.svg">
  <img src="../assets/architecture/features/file-list-group-by-directory-dataflow.light.svg" alt="变更文件目录树 · 算树数据流">
</picture>

> [交互版](../assets/architecture/features/file-list-group-by-directory-dataflow.html) · [Mermaid 源图](../assets/mermaid/features/file-list-group-by-directory-dataflow.mmd)（图资产溯源见 [图资产索引](../assets/mermaid/README.md)）

- **视图无关的 `FileTreeNode`**（[`shared/protocol.ts`](../../src/shared/protocol.ts)）：目录带 `name/path/children`，叶子带 `fileIndex` 回指扁平 `files[]`。同一套渲染逻辑服务两视图，且不复制条目数据。
- **构建算法**（[`engine/tree/file-tree.ts`](../../src/engine/tree/file-tree.ts)，纯逻辑、Vitest 覆盖）：`/` 分段建 trie；每级**目录在前、文件在后**，同类按名称数字感知升序、稳定（相等按插入序）；**compact 折叠**单目录子链（如 `a/b/c` → `a/b`，遇含叶子或多子目录即停，对齐 VS Code `explorer.compactFolders` 默认开启）；根级文件、同名异目录、空输入、重复路径（keep-first）均已覆盖。
- **切换零 host 往返**：平铺 `files[]` 与树 `tree[]` 同批下发，切换/折叠仅本地重渲。

## 两视图差异

| | Commit 视图 | Log 视图（右侧详情面板上半区） |
|---|---|---|
| 数据源 | 活动 Changelist 的 `CommitFileItem[]` | 选中提交 `diff-tree` 的 `LogCommitFileItem[]` |
| 建树路径 | 条目 `path`（仓库相对） | `CommitFileChange.path`（干净新路径，重命名归位到新目录） |
| 复选框 | 有：叶子勾选 + **目录三态**级联；Select All 基于全量文件 | 无（只读浏览） |
| 叶子单击 | 打开 Diff（`commit/openFile`） | 打开单文件 Diff（`log/openFile`，`data-path` 保持展示串不变） |
| 偏好持久化 | host `workspaceState`（`hyperGit.commit.dmode:<repo>`）+ webview `setState` 按仓库记 `collapsed`/`checked` | host `workspaceState`（`hyperGit.log.dmode:<repo>`）+ webview `dcollapsed` 按仓库记忆 |
| 切换控件 | Commit 标题栏 `$(list-tree)`/`$(list-flat)` 互斥图标（context key `hyperGit.commit.tree`） | Graph 标题栏 `$(list-tree)`/`$(list-flat)` 互斥图标（同 Branches 分组切换范式） |

## 实现

- 引擎：[`engine/tree/file-tree.ts`](../../src/engine/tree/file-tree.ts)（+ [`tests/unit/file-tree.test.ts`](../../tests/unit/file-tree.test.ts)，15 用例）。
- 协议：[`shared/protocol.ts`](../../src/shared/protocol.ts)（`FileTreeNode`；`CommitViewState.tree`；`log/commitFiles` payload `tree`）。
- 渲染：[`commit-webview.ts`](../../src/adapter/webview/commit-webview.ts)（`renderFlat`/`renderTree`、`makeLeafRow`、目录三态 `updateDirStates`；切换控件为 Commit 标题栏 `hyperGit.commit.detailTree/detailFlat` 命令图标，mode 以 host 为事实源随 `state` 整态下发）、[`log-webview.ts`](../../src/adapter/webview/log-webview.ts)（`renderDetails` 分派、`renderDetailNode`；Log 侧切换控件为 Graph 标题栏 `hyperGit.log.detailTree/detailFlat` 命令图标，模式经 `log/detailMode` 定向下发免整图重拉）。

## 验证

`pnpm run test:unit`（含 `file-tree.test.ts`）全绿；Extension Development Host（F5）：两视图 List/Tree 即时切换、刷新/切换提交后保持模式；树内目录可折叠、compact 生效；Commit 目录三态与 Select All 联动正确；树形叶子单击仍打开对应文件 Diff（含重命名项）。
