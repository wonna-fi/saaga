import { checkAnswer } from "../../src/checks.js";
import type { EvalTask } from "../../src/types.js";

/** Regression probe for stale claim #2 (plans/eval-seed-material.md). */
export const task: EvalTask = {
  id: "defect/copilot-restricted-flags",
  half: "defect",
  title: "Copilot CLI flags that implement restricted mode",
  kind: "answer",
  prompt:
    "When this project invokes the copilot CLI with a restricted permission profile, " +
    "which command-line flags implement the tool restriction? List only the flags used " +
    "in restricted mode, nothing else.",
  check: checkAnswer({
    must: [/--available-tools/, /--allow-tool\b/],
    mustNot: [/--allow-all-tools/],
  }),
};
