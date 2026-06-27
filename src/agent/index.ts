/**
 * Agent 层（AI 接缝）。
 *
 * 依赖 Engine 层但不依赖 Adapter 层（正交分解），确保 AI 能力可独立演进与替换 provider。
 * 五大接缝：ILlmProvider / ICommitMessageProvider / IPreCommitInspector / IChangelistGrouper / IConflictResolver。
 * 当前均为 Null 实现（零 AI 依赖，未启用 AI 用户零负担）；M5 替换为真实实现。
 */
export type { ILlmProvider, LlmSource, LlmAvailability, LlmAvailabilityState, NullLlmProvider } from './llm-provider';
export type { ICommitMessageProvider, CommitMessageInput, CommitMessageResult, NullCommitMessageProvider } from './commit-message';
export type { IPreCommitInspector, InspectionProblem, InspectionResult, NullPreCommitInspector } from './pre-commit';
export type { IChangelistGrouper, GroupSuggestion, NullChangelistGrouper } from './grouper';
export type { IConflictResolver, ConflictResolution, NullConflictResolver } from './conflict';
