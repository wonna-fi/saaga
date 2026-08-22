import { checkAnswer } from "../../src/checks.js";
import type { EvalTask } from "../../src/types.js";

/**
 * Depth-preservation probe: denial classification.
 *
 * The seed file phrased this around the `unexpected` class, but no CLI flag
 * addresses `unexpected` (see src/agent/audit.ts) — the flag-bearing class
 * is `out-of-workspace`, so the task asks about that one to keep the check
 * honest.
 */
export const task: EvalTask = {
  id: "neutral/denial-out-of-workspace",
  half: "neutral",
  title: "Meaning of the out-of-workspace denial class",
  kind: "answer",
  prompt:
    "A saaga permission-audit run reports a denial classified as `out-of-workspace`. " +
    "What does that classification mean, and which CLI flag lets a future run grant the " +
    "agent access to the location it tried to touch?",
  check: checkAnswer({
    must: [/--allow-dir/, /(outside|beyond|not (in|under|inside))/i],
  }),
};
