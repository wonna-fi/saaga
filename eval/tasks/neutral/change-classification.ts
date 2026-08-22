import { checkAnswer } from "../../src/checks.js";
import type { EvalTask } from "../../src/types.js";

/** Depth-preservation probe: change classification taxonomy. */
export const task: EvalTask = {
  id: "neutral/change-classification",
  half: "neutral",
  title: "Change detection classification of two file states",
  kind: "answer",
  prompt:
    "Consider a repo documented by saaga. Two files: (a) `notes.txt` is listed in BASELINE " +
    "and its content hash still matches, but an ignore pattern added since then now matches " +
    "it; (b) `util.py` is not listed in BASELINE and no ignore pattern matches it. " +
    "How does saaga's change detection classify each file in changes.md? " +
    "Give the exact classification label for each.",
  check: checkAnswer({
    must: [/newly[_\s-]?ignored/i, /\bnew\b/i],
  }),
};
