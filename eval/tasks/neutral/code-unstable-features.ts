import { checkTests } from "../../src/checks.js";
import { stubWith } from "../../src/fixtures.js";
import type { EvalTask } from "../../src/types.js";

const TARGET_FILE = "src/unstable-features.ts";
const TARGET_TESTS = ["tests/unstable-features.test.ts"];

/** Execution-graded re-implementation: unstable feature flags (PR #34). */
export const task: EvalTask = {
  id: "neutral/code-unstable-features",
  half: "neutral",
  title: "Re-implement the unstable-features registry",
  kind: "code",
  prompt:
    "The implementation of `src/unstable-features.ts` has been removed: its exported " +
    "functions throw \"not implemented\". Re-implement the file — it is a typed registry " +
    "of unstable feature flags with validation, config/CLI resolution, and process-wide " +
    "enabled-set state. The existing tests in `tests/unstable-features.test.ts` are the " +
    "specification; read them carefully. You cannot execute tests or any other commands, " +
    "and you must not modify any test file. Change only `src/unstable-features.ts`.",
  timeoutMs: 600_000,
  prepare: stubWith(
    new URL("./fixtures/code-unstable-features/unstable-features.ts.stub.txt", import.meta.url),
    TARGET_FILE,
  ),
  targetFiles: [TARGET_FILE],
  targetTests: TARGET_TESTS,
  check: checkTests(TARGET_TESTS),
};
