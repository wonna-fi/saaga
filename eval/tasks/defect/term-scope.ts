import { checkAnswer } from "../../src/checks.js";
import type { EvalTask } from "../../src/types.js";

/** Term-collision probe: does retrieval land on both meanings of "scope"? */
export const task: EvalTask = {
  id: "defect/term-scope",
  half: "defect",
  title: "Two meanings of 'scope'",
  kind: "answer",
  prompt:
    'The word "scope" has two distinct meanings in this project. Explain both meanings ' +
    "and where each applies.",
  check: checkAnswer({
    must: [/(step|flow|expression|variable|dictionar)/i, /(ignore|documentation)/i],
  }),
};
