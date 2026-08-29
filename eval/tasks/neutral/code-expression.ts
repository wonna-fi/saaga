import { checkTests } from "../../src/checks.js";
import { stubWith } from "../../src/fixtures.js";
import type { EvalTask } from "../../src/types.js";

const TARGET_FILE = "src/engine/expression.ts";
const TARGET_TESTS = ["tests/engine/expression.test.ts"];

/** Execution-graded re-implementation: the flow expression engine. */
export const task: EvalTask = {
  id: "neutral/code-expression",
  half: "neutral",
  title: "Re-implement the flow expression engine",
  kind: "code",
  prompt:
    "The implementation of `src/engine/expression.ts` has been removed: its exported " +
    "functions throw \"not implemented\". Re-implement the file — it provides `${...}` " +
    "template interpolation, raw-value resolution, and predicate evaluation over a flow's " +
    "variable scope. The existing tests in `tests/engine/expression.test.ts` are the " +
    "specification; read them carefully. You cannot execute tests or any other commands, " +
    "and you must not modify any test file. Change only `src/engine/expression.ts`.",
  timeoutMs: 600_000,
  prepare: stubWith(
    new URL("./fixtures/code-expression/expression.ts.stub.txt", import.meta.url),
    TARGET_FILE,
  ),
  targetFiles: [TARGET_FILE],
  targetTests: TARGET_TESTS,
  check: checkTests(TARGET_TESTS),
};
