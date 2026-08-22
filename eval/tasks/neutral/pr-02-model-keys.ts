import { checkAnswer } from "../../src/checks.js";
import type { EvalTask } from "../../src/types.js";

/**
 * Neutral task derived from merged PR #39 (open per-backend models map),
 * selected mechanically as one of the three most recent non-bot feature
 * PRs. See eval/README.md for the authoring caveat.
 */
export const task: EvalTask = {
  id: "neutral/pr-02-model-keys",
  half: "neutral",
  title: "Validation of custom model keys",
  kind: "answer",
  prompt:
    "What validation applies to custom model keys passed via `--model <key>=<model>` in " +
    "this project? Describe the allowed key format, and say what happens when the model " +
    "value after `=` is empty.",
  check: checkAnswer({
    must: [/(lowercase|a-z)/i, /letter/i, /(must not be empty|error)/i],
  }),
};
