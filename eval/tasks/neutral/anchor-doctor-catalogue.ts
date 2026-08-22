import { checkAnswer } from "../../src/checks.js";
import type { EvalTask } from "../../src/types.js";

/** Verified-true anchor fact: backend-specific doctor probes. */
export const task: EvalTask = {
  id: "neutral/anchor-doctor-catalogue",
  half: "neutral",
  title: "Doctor probes that run only for the claude backend",
  kind: "answer",
  prompt:
    "This project's doctor command has a probe catalogue. Which probes run only for the " +
    "claude backend? List their ids.",
  check: checkAnswer({
    must: [/tool-surface/, /absolute-path-anchoring/, /run-dir-writable/],
  }),
};
