import { checkAnswer } from "../../src/checks.js";
import type { EvalTask } from "../../src/types.js";

/** Term-collision probe: "slice" vs "phase" in the update workflow. */
export const task: EvalTask = {
  id: "defect/term-slice-vs-phase",
  half: "defect",
  title: "Slice vs phase in the update workflow",
  kind: "answer",
  prompt:
    "In this project's update workflow, what is a 'slice', and how does a slice relate " +
    "to a 'phase'?",
  check: checkAnswer({
    must: [/slice/i, /phase/i, /(doc|group|plan)/i],
  }),
};
