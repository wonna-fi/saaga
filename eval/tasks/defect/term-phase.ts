import { checkAnswer } from "../../src/checks.js";
import type { EvalTask } from "../../src/types.js";

/** Term-collision probe: does retrieval land on both meanings of "phase"? */
export const task: EvalTask = {
  id: "defect/term-phase",
  half: "defect",
  title: "Two meanings of 'phase'",
  kind: "answer",
  prompt:
    'The word "phase" is used for two different things in this project: it appears in ' +
    'terminal output like "Phase 2/5", and plans also have phases. Explain both meanings ' +
    "and name where each one lives in the codebase or workflow.",
  check: checkAnswer({
    must: [/(progress|terminal|output)/i, /plan/i],
  }),
};
