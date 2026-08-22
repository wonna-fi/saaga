import type { Backend } from "../../src/cli/backend.js";

/**
 * Shared types for the paired eval harness.
 *
 * The harness measures whether the `saaga-docs/` corpus helps a coding agent:
 * the same pre-registered tasks run in isolated sandboxes under different
 * documentation conditions, and per-task check scripts score each run.
 * See eval/README.md for method and caveats.
 */

export type ConditionId = "no-docs" | "saaga-docs" | "openwiki";

export const ALL_CONDITIONS: readonly ConditionId[] = ["no-docs", "saaga-docs", "openwiki"];

/**
 * Which half of the task set a task belongs to. The halves are reported
 * separately: defect-targeted tasks measure fix-verification of known doc
 * defects; only the neutral half supports the headline "does the corpus
 * help an agent" claim.
 */
export type TaskHalf = "defect" | "neutral";

/** What a task's check() gets to look at. Never includes the condition. */
export interface CheckCtx {
  sandboxDir: string;
  /** Content of <sandbox>/ANSWER.md, or "" when the agent never wrote it. */
  readAnswer(): Promise<string>;
  /** Content of a sandbox-relative file, or "" when absent. */
  readFile(rel: string): Promise<string>;
}

export interface CheckResult {
  pass: boolean;
  /** Which predicate failed, for the report's detail column. */
  detail?: string;
}

export interface EvalTask {
  /** Stable id, "<half>/<slug>", used for --tasks filtering and reporting. */
  id: string;
  half: TaskHalf;
  title: string;
  /**
   * "answer" tasks get the ANSWER.md instruction appended by the runner;
   * "code" tasks are expected to edit files and are checked on file state.
   */
  kind: "answer" | "code";
  /** Pre-registered fixed prompt. Must stay condition-blind. */
  prompt: string;
  /** Per-run timeout; defaults to DEFAULT_TASK_TIMEOUT_MS. */
  timeoutMs?: number;
  check(ctx: CheckCtx): Promise<CheckResult>;
}

export const DEFAULT_TASK_TIMEOUT_MS = 300_000;

export interface RunSpec {
  schemaVersion: 1;
  backend: Backend;
  /** Resolved model string actually passed to the backend. */
  model: string;
  /** The low|medium|high key the model was resolved from. */
  modelKey: string;
  /** Full SHA the sandboxes are built from. */
  rev: string;
  conditions: ConditionId[];
  reps: number;
  taskIds: string[];
  startedAt: string;
}

export interface RunMetrics {
  /** Harness wall-clock for the agent call; always present. */
  elapsedMs: number;
  turns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  costUsd?: number;
}

export interface TaskResult {
  taskId: string;
  half: TaskHalf;
  condition: ConditionId;
  /** 1-based repetition index. */
  rep: number;
  exitCode: number;
  pass: boolean;
  checkDetail?: string;
  metrics: RunMetrics;
  /** NDJSON transcript path, relative to the run directory. */
  logFile: string;
  /** Harness-level failure (timeout, sandbox error), not a task failure. */
  error?: string;
}

export interface EvalRunSummary {
  schemaVersion: 1;
  spec: RunSpec;
  results: TaskResult[];
  finishedAt?: string;
}
