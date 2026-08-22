import { checkAnswer } from "../../src/checks.js";
import type { EvalTask } from "../../src/types.js";

/** Depth-preservation probe: awaitProcess concurrent stream draining. */
export const task: EvalTask = {
  id: "neutral/backend-deadlock",
  half: "neutral",
  title: "Concurrency hazard when awaiting an agent CLI process",
  kind: "answer",
  prompt:
    "Suppose you are adding a new agent backend to this project. The backend spawns a CLI " +
    "process and parses its stdout as an event stream. What concurrency hazard must the " +
    "process-awaiting code avoid, and how does the existing shared helper avoid it?",
  check: checkAnswer({
    must: [/(pipe.?buffer|buffer|deadlock)/i, /(concurrent|simultaneous|drain|in parallel)/i],
  }),
};
