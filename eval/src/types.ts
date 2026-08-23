import type { Backend } from "../../src/cli/backend.js";

/**
 * Shared types for the paired eval harness.
 *
 * The harness measures whether the `saaga-docs/` corpus helps a coding agent:
 * the same pre-registered tasks run in isolated sandboxes under different
 * documentation conditions, and per-task check scripts score each run.
 * See eval/README.md for method and caveats.
 */

export type ConditionId = "no-docs" | "saaga-docs" | "docs-only" | "openwiki";

export const ALL_CONDITIONS: readonly ConditionId[] = [
  "no-docs",
  "saaga-docs",
  "docs-only",
  "openwiki",
];

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
  /** Host checkout; checkTests borrows its node_modules AFTER the agent run. */
  repoRoot: string;
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
  /**
   * Task-specific sandbox mutation, run after the condition mutation and
   * BEFORE the sandbox's initial commit (so git reveals nothing). Code
   * tasks overwrite their target files with committed stub fixtures here.
   */
  prepare?(sandboxDir: string): Promise<void>;
  /** Code tasks: sandbox-relative test files the checker executes. */
  targetTests?: readonly string[];
  /** Code tasks: sandbox-relative implementation files prepare() stubs. */
  targetFiles?: readonly string[];
  /**
   * Conditions this task runs in; absent = all. Populated ONLY by the
   * registry (harness policy) — task modules stay condition-blind.
   */
  appliesTo?: readonly ConditionId[];
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
  /**
   * Version of the pre-registered task set (see TASK_SET_VERSION in
   * registry.ts). Optional so summaries from before the field parse;
   * comparisons refuse to mix versions.
   */
  taskSetVersion?: number;
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
  /**
   * How many corpus files the agent opened during the run, counted from
   * the NDJSON transcript. undefined when no transcript was written
   * (fake-agent runs); 0 is a real measurement ("never opened the docs").
   */
  docsReads?: number;
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
