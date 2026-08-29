import { checkTests } from "../../src/checks.js";
import { stubWith } from "../../src/fixtures.js";
import type { EvalTask } from "../../src/types.js";

const TARGET_FILE = "src/scripts/file-manifest.ts";
const TARGET_TESTS = ["tests/scripts/file-manifest.test.ts"];

/** Execution-graded re-implementation: manifest walk with ignore layering. */
export const task: EvalTask = {
  id: "neutral/code-file-manifest",
  half: "neutral",
  title: "Re-implement the file manifest walk",
  kind: "code",
  prompt:
    "The implementation of `src/scripts/file-manifest.ts` has been removed: its exported " +
    "functions throw \"not implemented\". Re-implement the file — it walks a project " +
    "tree, applies layered ignore-file semantics, handles symlinks, and produces a " +
    "sorted manifest of git-style blob hashes. The existing tests in " +
    "`tests/scripts/file-manifest.test.ts` are the specification; read them carefully. " +
    "The `ignore` npm package is available. You cannot execute tests or any other " +
    "commands, and you must not modify any test file. Change only " +
    "`src/scripts/file-manifest.ts`.",
  timeoutMs: 600_000,
  prepare: stubWith(
    new URL("./fixtures/code-file-manifest/file-manifest.ts.stub.txt", import.meta.url),
    TARGET_FILE,
  ),
  targetFiles: [TARGET_FILE],
  targetTests: TARGET_TESTS,
  check: checkTests(TARGET_TESTS),
};
