import { checkAnswer } from "../../src/checks.js";
import type { EvalTask } from "../../src/types.js";

/** Regression probe for stale claim #4 (plans/eval-seed-material.md). */
export const task: EvalTask = {
  id: "defect/fake-agent-shell-assert",
  half: "defect",
  title: "Vitest assertion on the fake agent's recorded shell policy",
  kind: "answer",
  prompt:
    "This project has a fake agent test double that records every call it receives. " +
    "Write a single vitest `expect(...)` assertion verifying that the first recorded " +
    "call requested restricted shell. Write exactly the assertion line.",
  check: checkAnswer({
    must: [/permissions\??\.\s*shell/, /["']restricted["']/],
    mustNot: [/read-only-git/],
  }),
};
