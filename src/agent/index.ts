/**
 * Agent 层（AI 接缝，预留）。
 *
 * 依赖 Engine 层但不依赖 Adapter 层（正交分解），确保 AI 能力可独立演进与替换 provider。
 * M5 实现：ILlmProvider / IPreCommitInspector / IChangelistGrouper / IConflictResolver +
 * Chat Tools（`languageModelTools`）暴露 git 能力给任意 Agent。
 */
export type { ILlmProvider, LlmSource, LlmAvailability, LlmAvailabilityState, NullLlmProvider } from './llm-provider';
export type { IPreCommitInspector, InspectionProblem, InspectionResult } from './pre-commit';
