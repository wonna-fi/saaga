import type { ConditionId, EvalTask } from "./types.js";

import { task as copilotRestrictedFlags } from "../tasks/defect/copilot-restricted-flags.js";
import { task as configDefaultBackend } from "../tasks/defect/config-default-backend.js";
import { task as fakeAgentShellAssert } from "../tasks/defect/fake-agent-shell-assert.js";
import { task as shellPolicyValues } from "../tasks/defect/shell-policy-values.js";
import { task as termPhase } from "../tasks/defect/term-phase.js";
import { task as termScope } from "../tasks/defect/term-scope.js";
import { task as termSliceVsPhase } from "../tasks/defect/term-slice-vs-phase.js";
import { task as anchorDoctorCatalogue } from "../tasks/neutral/anchor-doctor-catalogue.js";
import { task as anchorModelDefaults } from "../tasks/neutral/anchor-model-defaults.js";
import { task as backendDeadlock } from "../tasks/neutral/backend-deadlock.js";
import { task as bashDenyReasoning } from "../tasks/neutral/bash-deny-reasoning.js";
import { task as changeClassification } from "../tasks/neutral/change-classification.js";
import { task as denialOutOfWorkspace } from "../tasks/neutral/denial-out-of-workspace.js";
import { task as pr01RunCommand } from "../tasks/neutral/pr-01-run-command.js";
import { task as pr02ModelKeys } from "../tasks/neutral/pr-02-model-keys.js";
import { task as pr03Saagarules } from "../tasks/neutral/pr-03-saagarules.js";
import { task as saagaignoreSymlinks } from "../tasks/neutral/saagaignore-symlinks.js";
import { task as codeSaagarules } from "../tasks/neutral/code-saagarules.js";
import { task as codeModelOverrides } from "../tasks/neutral/code-model-overrides.js";
import { task as codeExpression } from "../tasks/neutral/code-expression.js";
import { task as codeUnstableFeatures } from "../tasks/neutral/code-unstable-features.js";
import { task as codeDenialClassify } from "../tasks/neutral/code-denial-classify.js";
import { task as codeFileManifest } from "../tasks/neutral/code-file-manifest.js";

/**
 * Version of the pre-registered task set. Bump on ANY change to task
 * membership, a prompt, a check predicate, a prepare()/stub fixture, or
 * this file's condition scoping — comparisons refuse to mix versions, so
 * a bump means both sides of any comparison must be re-run.
 *
 * v1: 17 answer tasks (the committed 2026-08-23 baselines).
 * v2: + 6 code tasks (execution-graded re-implementation).
 */
export const TASK_SET_VERSION = 2;

/**
 * Condition applicability is harness policy, not task content, so it
 * lives here rather than in the task modules — the condition-blindness
 * test greps eval/tasks/** and must keep finding nothing. Code tasks
 * skip docs-only: there is no source tree to re-implement into.
 */
const CODE_TASK_CONDITIONS: readonly ConditionId[] = ["no-docs", "saaga-docs", "openwiki"];
const CONDITION_SCOPE: Record<string, readonly ConditionId[]> = {
  "neutral/code-saagarules": CODE_TASK_CONDITIONS,
  "neutral/code-model-overrides": CODE_TASK_CONDITIONS,
  "neutral/code-expression": CODE_TASK_CONDITIONS,
  "neutral/code-unstable-features": CODE_TASK_CONDITIONS,
  "neutral/code-denial-classify": CODE_TASK_CONDITIONS,
  "neutral/code-file-manifest": CODE_TASK_CONDITIONS,
};

/**
 * The pre-registered task set. Order is the deterministic run order.
 *
 * Both halves must land in one PR before any real condition runs — the
 * pre-registration discipline from plans/eval-seed-material.md.
 */
const RAW_TASKS: readonly EvalTask[] = [
  shellPolicyValues,
  copilotRestrictedFlags,
  configDefaultBackend,
  fakeAgentShellAssert,
  termPhase,
  termScope,
  termSliceVsPhase,
  changeClassification,
  saagaignoreSymlinks,
  denialOutOfWorkspace,
  backendDeadlock,
  bashDenyReasoning,
  anchorModelDefaults,
  anchorDoctorCatalogue,
  pr01RunCommand,
  pr02ModelKeys,
  pr03Saagarules,
  codeSaagarules,
  codeModelOverrides,
  codeExpression,
  codeUnstableFeatures,
  codeDenialClassify,
  codeFileManifest,
];

export const EVAL_TASKS: readonly EvalTask[] = RAW_TASKS.map((task) =>
  CONDITION_SCOPE[task.id] ? { ...task, appliesTo: CONDITION_SCOPE[task.id] } : task,
);

/** Throws when the registry violates its own invariants. */
export function validateRegistry(tasks: readonly EvalTask[] = EVAL_TASKS): void {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) throw new Error(`duplicate task id: ${task.id}`);
    ids.add(task.id);
    if (!task.id.startsWith(`${task.half}/`)) {
      throw new Error(`task id '${task.id}' does not match its half '${task.half}'`);
    }
  }
  if (tasks.length < 10 || tasks.length > 25) {
    throw new Error(`task set must hold 10-25 tasks, found ${tasks.length}`);
  }

  for (const scopedId of Object.keys(CONDITION_SCOPE)) {
    if (!ids.has(scopedId)) {
      throw new Error(`CONDITION_SCOPE names unregistered task id: ${scopedId}`);
    }
  }

  const stubbedFiles = new Set<string>();
  for (const task of tasks) {
    if (task.kind !== "code") continue;
    if (!task.prepare) throw new Error(`code task ${task.id} lacks prepare()`);
    if (!task.targetTests?.length) throw new Error(`code task ${task.id} lacks targetTests`);
    if (!task.targetFiles?.length) throw new Error(`code task ${task.id} lacks targetFiles`);
    if (!task.appliesTo || task.appliesTo.includes("docs-only")) {
      throw new Error(`code task ${task.id} must be scoped out of docs-only`);
    }
    for (const file of task.targetFiles) {
      if (stubbedFiles.has(file)) {
        throw new Error(`code tasks stub the same file twice: ${file}`);
      }
      stubbedFiles.add(file);
    }
  }
}

/** Expand --tasks selectors ("defect/*", exact ids) into tasks, in registry order. */
export function selectTasks(
  selectors: readonly string[] | undefined,
  tasks: readonly EvalTask[] = EVAL_TASKS,
): EvalTask[] {
  if (!selectors || selectors.length === 0) return [...tasks];
  const picked = tasks.filter((task) =>
    selectors.some((sel) =>
      sel.endsWith("/*") ? task.id.startsWith(sel.slice(0, -1)) : task.id === sel,
    ),
  );
  if (picked.length === 0) {
    throw new Error(`no tasks match selectors: ${selectors.join(", ")}`);
  }
  return picked;
}
