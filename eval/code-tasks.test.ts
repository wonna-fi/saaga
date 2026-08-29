import { copyFile, readFile, rm, symlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execa } from "execa";
import { afterAll, describe, expect, test } from "vitest";
import { EVAL_TASKS } from "./src/registry.js";
import { createSandbox, type Sandbox } from "./src/sandbox.js";

/**
 * Drift guard for the code tasks.
 *
 * The stub fixtures are whole-file snapshots; a refactor or one of the
 * daily docs-bot commits can silently invalidate them (moved file, changed
 * export set, relocated tests). This test fails CI before any paid eval
 * run does: every task's stub must actually break its target tests, and
 * copying the host's real implementation back must make them all pass.
 * A legitimate fixture refresh is a TASK_SET_VERSION bump.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const codeTasks = EVAL_TASKS.filter((t) => t.kind === "code");

const CHILD_ENV = {
  VITEST: undefined,
  VITEST_MODE: undefined,
  VITEST_POOL_ID: undefined,
  VITEST_WORKER_ID: undefined,
  TEST: undefined,
  NODE_ENV: undefined,
  FORCE_COLOR: "0",
};

describe("code-task drift guard", () => {
  let sandbox: Sandbox | undefined;
  afterAll(async () => {
    await sandbox?.cleanup();
  });

  test("every stub breaks its tests; every host implementation passes them", async () => {
    expect(codeTasks.length).toBeGreaterThanOrEqual(4);

    sandbox = await createSandbox({
      repoRoot,
      rev: "HEAD",
      condition: "saaga-docs",
      prepare: async (dir) => {
        for (const t of codeTasks) await t.prepare!(dir);
      },
    });
    const { sandboxDir } = sandbox;
    const allTests = codeTasks.flatMap((t) => [...(t.targetTests ?? [])]);
    const vitestBin = join(repoRoot, "node_modules", "vitest", "vitest.mjs");
    await symlink(join(repoRoot, "node_modules"), join(sandboxDir, "node_modules"), "dir");

    // Phase 1: with stubs in place, every task's target file must fail.
    const stubbed = await execa(
      process.execPath,
      [vitestBin, "run", ...allTests, "--reporter=json", "--outputFile=vitest-report.json"],
      { cwd: sandboxDir, env: CHILD_ENV, reject: false, timeout: 180_000 },
    );
    expect(stubbed.exitCode).not.toBe(0);
    const report = JSON.parse(
      await readFile(join(sandboxDir, "vitest-report.json"), "utf8"),
    ) as { testResults: { name: string; status: string }[] };
    for (const t of codeTasks) {
      const broken = report.testResults.some(
        (r) =>
          r.status === "failed" &&
          (t.targetTests ?? []).some((f) => r.name.endsWith(`/${f}`)),
      );
      expect(broken, `${t.id}: stub does not break its target tests`).toBe(true);
    }
    await rm(join(sandboxDir, "vitest-report.json"), { force: true });

    // Phase 2: the host's real implementations must satisfy the same tests
    // (stub exports still match reality; tests haven't moved).
    for (const t of codeTasks) {
      for (const f of t.targetFiles ?? []) {
        await copyFile(join(repoRoot, f), join(sandboxDir, f));
      }
    }
    const restored = await execa(
      process.execPath,
      [vitestBin, "run", ...allTests],
      { cwd: sandboxDir, env: CHILD_ENV, reject: false, timeout: 180_000 },
    );
    expect(
      restored.exitCode,
      `restored implementations fail:\n${restored.stdout}\n${restored.stderr}`,
    ).toBe(0);
  }, 300_000);
});
