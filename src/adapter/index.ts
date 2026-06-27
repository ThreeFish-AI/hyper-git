/**
 * Adapter 层（M1+ 实现）：唯一接触 vscode API 的层。
 *
 * 计划实现：
 * - GitRepositoryAdapter：封装 `vscode.git` 导出的 `Repository` API（commit/add/diff/log/stash/branch…）。
 * - ChangelistRegistry：active 列表 / 分组 / 移动 / `workspaceState` 持久化。
 * - TreeDataProvider：Changes / Branches / Shelf / Stash。
 * - WebviewHost：Commit 窗口 + Log 图（postMessage 协议，契约见 shared/protocol.ts）。
 * - DiffContentProvider：自定义 scheme 提供任意 ref 版本。
 *
 * M0 仅占位，保留目录结构。
 */
export {};
