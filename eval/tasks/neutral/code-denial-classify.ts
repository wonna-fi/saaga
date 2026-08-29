import { checkTests } from "../../src/checks.js";
import { stubWith } from "../../src/fixtures.js";
import type { EvalTask } from "../../src/types.js";

const TARGET_FILE = "src/agent/audit.ts";
const TARGET_TESTS = ["tests/agent/audit.test.ts"];

/** Execution-graded re-implementation: permission-denial classification. */
export const task: EvalTask = {
  id: "neutral/code-denial-classify",
  half: "neutral",
  title: "Re-implement denial classification and the permission auditor",
  kind: "code",
  prompt:
    "In `src/agent/audit.ts`, the implementations of `classifyDenial` and the " +
    "`PermissionAuditor` class have been removed and now throw \"not implemented\"; the " +
    "types and class notes remain. Re-implement them — they classify refused tool calls " +
    "against a permission profile and write a grouped audit log. The existing tests in " +
    "`tests/agent/audit.test.ts` are the specification; read them carefully. You cannot " +
    "execute tests or any other commands, and you must not modify any test file. Change " +
    "only `src/agent/audit.ts`.",
  timeoutMs: 600_000,
  prepare: stubWith(
    new URL("./fixtures/code-denial-classify/audit.ts.stub.txt", import.meta.url),
    TARGET_FILE,
  ),
  targetFiles: [TARGET_FILE],
  targetTests: TARGET_TESTS,
  check: checkTests(TARGET_TESTS),
};
