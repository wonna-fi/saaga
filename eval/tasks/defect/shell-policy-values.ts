import { checkAnswer } from "../../src/checks.js";
import type { EvalTask } from "../../src/types.js";

/** Regression probe for stale claim #1 (plans/eval-seed-material.md). */
export const task: EvalTask = {
  id: "defect/shell-policy-values",
  half: "defect",
  title: "Exact values of the permission profile's shell field",
  kind: "answer",
  prompt:
    "In this codebase, agent runs carry a permission profile with a `shell` field. " +
    "What are the exact possible values of that field? List every allowed value and nothing else.",
  check: checkAnswer({
    must: [/\bnone\b/, /\brestricted\b/],
    mustNot: [/read.?only.?git/i],
  }),
};
