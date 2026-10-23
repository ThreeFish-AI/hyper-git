# 分支就地更新（Update Branch Without Checkout）

> Branches 视图中**不 checkout 即可把本地分支更新到其远程版本**：右键单个分支 Update、多选批量 Update、标题栏 Pull 按钮升级为选区感知（无选区时保持原 Pull 语义）。底层原语 `git fetch <remote> refs/heads/<upstream>:refs/heads/<branch>`，git 原生 fast-forward-only，diverged / ahead-only 分支被安全拒绝，**永不改写本地提交**。

## 动机

对齐 IntelliJ IDEA 的 `GitUpdateSelectedBranchAction`：多分支并行开发时，让非当前分支跟上远程（如同步他人已合并 PR 的分支）此前必须 checkout → pull → checkout 回来；标题栏 Pull 也只作用于当前分支。本特性把「更新分支」从「必须身处该分支」中解耦。

## 核心原语：fetch refspec 而非 pull

| 场景 | 行为 |
|---|---|
| 非当前分支、落后远程 | `git fetch origin refs/heads/feature/foo:refs/heads/feature/foo` → 本地 ref fast-forward，工作区零扰动 |
| 非当前分支、已同步 | fetch 静默 no-op（exit 0）→ 事后 sha 对比归入 `already up to date` 桶 |
| 非当前分支、diverged / ahead-only | git 拒绝（`! [rejected] ... (non-fast-forward)`）→ 失败桶，**无 force 通道** |
| 当前分支 | fetch refspec 必被 git 拒绝（`refusing to fetch into branch '…' checked out at '…'`）→ 排程为 `repo.pull()`（含冲突处理通道） |
| 分支被其他 worktree checkout | git 拒绝 → 失败桶附 stderr 原因 |

副作用收益：带显式 refspec 的 fetch 同步刷新 remote-tracking ref，视图 ahead/behind 随之归真。refspec src 侧全限定 `refs/heads/<upstream>`：`+` 开头的合法上游名（如 `origin/+foo`）裸写时首 `+` 会被 git 解析为 force 前缀，静默绕过 fast-forward-only。

## 三入口与目标解析链

单一命令 `hyperGit.branchUpdate`（"Update Branch"，`$(arrow-down)`），目标解析链：**右键实参 →（无实参的标题栏路径）`branchesView.selection` → 无选区等价 Pull（委托既有 `hyperGit.pull`）**；选区非空但不含本地分支（仅远程/标签/分组节点）时不动作——显式选区优先，不回退 Pull。

- **右键**（`view/item/context`，`viewItem == hyperGit.branch`，组 `1_branch@1.7`）：单选作用于点击项；多选作用于整个选区（when 子句无 `!listMultiSelection`，与批量删除同契约），谓词过滤掉远程/标签节点，「点击在选区之外」以点击项为准（复用 `collectBranchRefs`）。当前分支节点同样显示 Update——路由到 pull，与 IDEA 行为一致。
- **标题栏**（`view/title`，`navigation@3`，原全局 Pull 位）：按钮读 Branches 视图选区（仅远程/标签/分组节点时不动作）；Commit 视图的 `hyperGit.pull` 保留原语义，跨视图零影响。

## 分层：引擎排程、适配层执行（单一事实源）

- **引擎纯逻辑** [`engine/ref/branch-update.ts`](../../src/engine/ref/branch-update.ts)（零 vscode 依赖、Vitest 覆盖）：
  - `planBranchUpdates(names, refByShort, headName, remotes)` 把选中短名排程为逐分支动作——`pull-current`（head 命中，fetch 必败故改走 pull）/ `fetch`（携带 remote、upstreamBranch、beforeSha）/ `skip-no-upstream`（无上游或上游无法归属已知 remote）。upstream 短名（`origin/x`）拆分复用 [`resolveRemoteBranch`](../../src/engine/ref/remote-ref.ts) 最长前缀匹配（remote 名可含 `/`）。
  - `formatBranchUpdateResult` 把五桶（updated / upToDate / pulled / skipped / failed）汇总为通知文案与级别——零计数段省略、失败附真实原因（stderr 优先、折叠单行、超 4 条截断），保证「选中数 = 各桶之和」可对账。
  - `classifyFetchOutcome` 以前缀语义比对前后短 sha 归类 updated / upToDate——`%(objectname:short)` 缩写长度随仓库对象数自动伸缩，批量 fetch 落库新对象可能使缩写变长，严格全等会把 up-to-date 误报为 updated；after 缺失（并发删除）保守计 updated。
- **适配层** [`adapter/remote-commands.ts`](../../src/adapter/remote-commands.ts)：命令编排。**不信任树节点数据**——API 路径的 `refToRaw` 不填 `upstream/head`，一律先以一次 `git for-each-ref`（`FOR_EACH_REF_FORMAT` + `parseForEachRef`）取全量新鲜快照再排程；逐分支执行（per-item try/catch，`branchDelete`/`deleteRemoteBranch` 批量范式），pull-current 失败先走 `handleGitConflict` 展示冲突 UI 但仍计入失败桶；事后一次 for-each-ref 经 `classifyFetchOutcome` 以 `objectname` 前后对比区分 updated / upToDate（fetch 静默 no-op 无输出可解析；读取失败保守计 updated）。

逐分支而非合并 refspec（`git fetch origin b1:… b2:…`）：合并执行丢失逐分支错误归因——任一 refspec 被拒即整命令失败且 stderr 混排，无法落桶。

## 边界

- **detached HEAD**：标题栏无选区兜底时警示（对齐 push 的 detached 提示），不盲跑。
- **无 remote**：`remotes` 为空（未配置/元数据未就绪）→ 提示 `No remote repository configured` 提前返回（对齐 pushDialog / deleteRemoteBranch 先例），不把有上游分支误报 `no upstream`。
- **陈旧上游**：上游指向已删除的 remote（remotes 非空时）→ `resolveRemoteBranch` 返回 null → skip 桶透明提示 `no upstream`。
- **快照竞态**：分支刚被并发删除 → 快照缺失 → skip 桶（不 crash、不误执行）。
- **进度**：`runWithProgress`（Window 位置，非阻塞）；execFile 无 kill 通道，不可取消（`task-progress.ts` 既有约束）。
