# 多根工作区仓库切换（Multi-root Repository Selection）

> 多根工作区（multi-root）含多个 Git 仓库时，**Graph 工具栏仓库名升级为可切换按钮**（对标 Git Graph 的 repo selector），Command Palette 亦可直达。切换的是**全局活跃仓库**：Graph / Branches / Commit（changelist）/ Stash / Shelf / Worktrees / 未提交角标**全部视图跟随**，changelist 分配、分支收藏、分支分组偏好、Shelf 存储、最近提交消息**按仓库隔离记忆**，重开窗口回到上次操作的仓库。

## 交互形态

```mermaid
flowchart LR
  subgraph TOOLBAR["Graph 工具栏"]
    A["All · Current · Checkpoints"] --- B["repo-a ▾<br/>(可点击按钮)"]
  end
  B -->|click + postMessage log/selectRepo| C["QuickPick<br/>$(repo) repo-a /repo-a ✓<br/>$(repo) repo-b /workspace/repo-b"]
  C -->|选中| D["service.selectRepository(root)"]
  D --> E["全局活跃仓库切换<br/>七个视图 + 持久化状态级联跟随"]
  style B fill:#1f6feb,color:#fff
  style D fill:#238636,color:#fff
  style E fill:#8957e5,color:#fff
```

- **入口一（主）**：Graph 工具栏右侧仓库名按钮——多仓库时显示 `basename ▾`、hover 高亮，单仓库退化为纯文本（现状观感，多数用户零感知）；
- **入口二**：Command Palette → `Hyper Git: Select Repository…`（单仓库时提示 no-op）；
- **持久化**：活跃仓库记于 `workspaceState`（`hyperGit.activeRepoRoot`，per-workspace 天然隔离），重开窗口恢复。

## 设计：全局活跃仓库 + 三重顺序不变量

沿用既有架构事实源——`GitRepositoryService` 是唯一活跃仓库持有者，全部 `execGit` 调用（cwd 恒为活跃仓库根）**零改动自动跟随**。核心新增是仓库切换的**级联时序**：

```mermaid
sequenceDiagram
  participant U as 用户
  participant S as GitRepositoryService
  participant R as rebind 订阅<br/>(extension.ts)
  participant V as 视图刷新链

  U->>S: selectRepository(rootB)
  S->>S: applyRepository(repoB)
  S-->>R: ① onDidChangeRepository.fire（同步）
  R->>R: registry/favorites/branchesTree.setRepoRoot
  R->>R: branchesGrouping context key 同步
  R->>R: blame 注解清理 · Graph filter 清空
  S-->>V: ② onDidChange.fire（其后）
  V->>V: refreshAll（150ms 防抖）重取数据
```

- **① 先于 ②**：rebind（换 memento key、重载状态）在同步栈完成，任何视图重取数据必然发生在 rebind 之后；
- **rebind 订阅先注册**：`extension.ts` 中先于 `service.onDidChange(refreshAll)` 挂载；
- **防抖兜底**：即使前两层被未来改动破坏，150ms/400ms 防抖刷新仍晚于同步 rebind。

**契约**：任何构造期快照 `repoRoot` 的新组件，必须订阅 `onDidChangeRepository` 重绑（见 `GitRepositoryService` 类 JSDoc）。

## 选取优先级（`engine/git-state/repo-selection.ts`）

纯函数 `pickRepositoryRoot` 三级优先（`onDidOpenRepository` / `onDidCloseRepository` / 手动选择后均走此逻辑）：

1. **持久化恢复**：`hyperGit.activeRepoRoot` 仍存在于已发现仓库 → 恢复（消除 VS Code 发现顺序不稳定的漂移）；
2. **首个工作区文件夹**命中的仓库（folder 为 git root 或位于某 repo 内）；
3. **首个已发现仓库**（与旧版行为兼容）。

路径归一化（去尾分隔符 + Windows 盘符大小写不敏感）保证跨平台稳定比较。仓库被移除 → 规则 1 miss 自动回退并覆写持久化（自愈）。

## 按仓库隔离的持久化状态

| 状态 | 键 / 目录 | rebind 机制 |
| --- | --- | --- |
| Changelist 分配 | `hyperGit.changelists:${repoRoot}` | `setRepoRoot` 换 key 重载（幂等守卫 → 换 key → reload → fire） |
| 分支收藏 | `hyperGit.branchFavorites:${repoRoot}` | 同上 |
| 分支分组偏好 | `hyperGit.branchesGrouping:${repoRoot}` | 同上 + context key 同步 |
| Shelf 存储 | `shelves/<basename>.<sha1[:8]>/` | 目录随 `service.repoRoot` **动态求值**（零快照零双源） |
| 最近提交消息 | `hyperGit.recentCommitMessages:${repoRoot}` | 动态 key + 旧全局 key 回落一次（平滑迁移） |
| Graph 视图状态（scope/选中/详情模式） | webview `vscode.getState()` v2 `byRepo` 分区 | `graphData` 到达时按 `repoRoot` 换装载 |
| Commit 勾选集/视图模式 | 同上 | 同上（勾选是相对路径集合，跨仓库本就错位） |

**Shelf 历史数据迁移**：旧版平铺 `shelves/*.json` 不分仓库，首次使用时一次性 `rename` 到当前活跃仓库子目录——**零删除、目标已存在即跳过（零覆盖）、失败可重试**；多仓库历史混仓数据无法事后归因，归属当前活跃仓库（Known Limitation）。

## 集成测试

`tests/suite/multi-root.test.js`（`run-integration.js` 构造 `repo-a`/`repo-b` 双仓库 `.code-workspace` 后追加第二段 VS Code 启动）：

- `hyperGit.selectRepository` 命令注册冒烟；
- 程序化切换（`activate()` 导出 `{ service }` 接缝）：repoA ⇄ repoB 断言 `repoRoot` 跟随，切换后 refreshLog / refreshBranches / refresh 不抛错；
- 切换不存在路径返回 `false` 不炸；
- `listRepositories()` 返回两个仓库。

单仓库场景下选取算法与旧版行为完全一致（既有三套件零改动通过），单仓库用户零破坏。

## 已知限制

- 仓库切换时 Graph 的 host 级过滤条件（author/path/grep 等）清空——过滤条件是旧仓库语境的产物，跨仓库无意义；
- 多仓库历史混仓 Shelf 数据归属迁移时的当前活跃仓库（无法按仓库归因）；
- CI 状态按 commit hash 缓存（跨仓库理论碰撞概率可忽略，行为正确）。
