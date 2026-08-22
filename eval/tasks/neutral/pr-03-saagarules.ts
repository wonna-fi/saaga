import { checkAnswer } from "../../src/checks.js";
import type { EvalTask } from "../../src/types.js";

/**
 * Neutral task derived from merged PR #35 (.saagarules support), selected
 * mechanically as one of the three most recent non-bot feature PRs.
 * See eval/README.md for the authoring caveat.
 */
export const task: EvalTask = {
  id: "neutral/pr-03-saagarules",
  half: "neutral",
  title: "Location, size cap, and delivery of .saagarules",
  kind: "answer",
  prompt:
    "Where must a `.saagarules` file be located for saaga to pick it up, what is the " +
    "maximum allowed size, and how does its content reach the agent?",
  check: checkAnswer({
    must: [/root/i, /(64\s*KiB|64\s*KB|65,?536)/i, /(append|prompt|instruction)/i],
  }),
};
