import { checkAnswer } from "../../src/checks.js";
import type { EvalTask } from "../../src/types.js";

/** Depth-preservation probe: bare Bash deny vs scoped allows. */
export const task: EvalTask = {
  id: "neutral/bash-deny-reasoning",
  half: "neutral",
  title: "When the claude settings use a bare Bash deny",
  kind: "answer",
  prompt:
    "In the permission settings this project generates for the claude backend, under which " +
    "shell policy is a bare `Bash` deny rule emitted, and why is that bare deny not used " +
    "under the other shell policy?",
  check: checkAnswer({
    must: [/\bnone\b/, /(precedence|defeats?|overrides?|wins? over)/i],
  }),
};
