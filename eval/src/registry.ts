import type { EvalTask } from "./types.js";

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

/**
 * The pre-registered task set. Order is the deterministic run order.
 *
 * Both halves must land in one PR before any real condition runs — the
 * pre-registration discipline from plans/eval-seed-material.md.
 */
export const EVAL_TASKS: readonly EvalTask[] = [
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
];

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
  if (tasks.length < 10 || tasks.length > 20) {
    throw new Error(`task set must hold 10-20 tasks, found ${tasks.length}`);
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
