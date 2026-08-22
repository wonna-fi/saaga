import { checkAnswer } from "../../src/checks.js";
import type { EvalTask } from "../../src/types.js";

/** Regression probe for stale claim #3 (plans/eval-seed-material.md). */
export const task: EvalTask = {
  id: "defect/config-default-backend",
  half: "defect",
  title: "Config field that supplies the fallback backend",
  kind: "answer",
  prompt:
    "When the `--backend` flag is omitted, saaga falls back to a field in `.saaga/config.yaml`. " +
    "What is the exact field name? Answer with the field name only.",
  check: checkAnswer({
    must: [/defaultBackend/],
  }),
};
