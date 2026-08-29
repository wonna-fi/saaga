import { checkAnswer } from "../../src/checks.js";
import type { EvalTask } from "../../src/types.js";

/** Verified-true anchor fact: built-in model defaults. */
export const task: EvalTask = {
  id: "neutral/anchor-model-defaults",
  half: "neutral",
  title: "Built-in claude model defaults per key",
  kind: "answer",
  prompt:
    "What are the built-in default model strings for the claude backend's `low`, `medium`, " +
    "and `high` model keys in this project?",
  check: checkAnswer({
    must: [/haiku/i, /sonnet/i, /opus/i],
  }),
};
