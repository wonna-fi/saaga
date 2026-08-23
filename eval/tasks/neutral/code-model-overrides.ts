import { checkTests } from "../../src/checks.js";
import { stubWith } from "../../src/fixtures.js";
import type { EvalTask } from "../../src/types.js";

const TARGET_FILE = "src/cli/backend.ts";
const TARGET_TESTS = ["tests/cli/backend.test.ts"];

/** Execution-graded re-implementation: the per-backend models map (PR #39). */
export const task: EvalTask = {
  id: "neutral/code-model-overrides",
  half: "neutral",
  title: "Re-implement model-key validation, overrides, and resolution",
  kind: "code",
  prompt:
    "In `src/cli/backend.ts`, the model-configuration functions `isValidModelKey`, " +
    "`parseModelOverrides`, `mergeModelOverrides`, and `resolveModel` have had their " +
    "implementations removed and now throw \"not implemented\"; the rest of the file is " +
    "intact. Re-implement those functions. The existing tests in " +
    "`tests/cli/backend.test.ts` are the specification; read them carefully — error " +
    "message wording matters. You cannot execute tests or any other commands, and you " +
    "must not modify any test file. Change only `src/cli/backend.ts`.",
  timeoutMs: 600_000,
  prepare: stubWith(
    new URL("./fixtures/code-model-overrides/backend.ts.stub.txt", import.meta.url),
    TARGET_FILE,
  ),
  targetFiles: [TARGET_FILE],
  targetTests: TARGET_TESTS,
  check: checkTests(TARGET_TESTS),
};
