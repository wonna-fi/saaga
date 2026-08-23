import { checkTests } from "../../src/checks.js";
import { stubWith } from "../../src/fixtures.js";
import type { EvalTask } from "../../src/types.js";

const TARGET_FILE = "src/saaga-rules.ts";
const TARGET_TESTS = ["tests/saaga-rules.test.ts"];

/** Execution-graded re-implementation: the .saagarules loader (PR #35). */
export const task: EvalTask = {
  id: "neutral/code-saagarules",
  half: "neutral",
  title: "Re-implement the .saagarules loader",
  kind: "code",
  prompt:
    "The implementation of `src/saaga-rules.ts` has been removed: its exported functions " +
    "throw \"not implemented\". Re-implement the file — it loads and validates a " +
    "project-provided instructions file and appends its content to prompts. The existing " +
    "tests in `tests/saaga-rules.test.ts` are the specification; read them carefully. " +
    "You cannot execute tests or any other commands, and you must not modify any test " +
    "file. Change only `src/saaga-rules.ts`.",
  timeoutMs: 600_000,
  prepare: stubWith(
    new URL("./fixtures/code-saagarules/saaga-rules.ts.stub.txt", import.meta.url),
    TARGET_FILE,
  ),
  targetFiles: [TARGET_FILE],
  targetTests: TARGET_TESTS,
  check: checkTests(TARGET_TESTS),
};
