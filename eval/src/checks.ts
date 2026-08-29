import { access, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import type { CheckCtx, CheckResult } from "./types.js";

/**
 * Regex-based answer grading.
 *
 * Every predicate is pre-registered with its task and stays condition-blind:
 * checks only see the sandbox, never which condition produced it. Regexes
 * must not use the `g` flag (a sticky lastIndex would make `.test` stateful).
 */
export interface AnswerRules {
  /** All must match ANSWER.md for a pass. */
  must: RegExp[];
  /** None may match; used to catch known-stale claims. */
  mustNot?: RegExp[];
}

export function checkAnswer(rules: AnswerRules): (ctx: CheckCtx) => Promise<CheckResult> {
  return async (ctx) => {
    const answer = await ctx.readAnswer();
    if (answer.trim() === "") {
      return { pass: false, detail: "ANSWER.md missing or empty" };
    }
    for (const re of rules.must) {
      if (!re.test(answer)) {
        return { pass: false, detail: `expected match missing: ${re.toString()}` };
      }
    }
    for (const re of rules.mustNot ?? []) {
      if (re.test(answer)) {
        return { pass: false, detail: `forbidden match present: ${re.toString()}` };
      }
    }
    return { pass: true };
  };
}

export interface CheckTestsOptions {
  /** Whole child-vitest budget. */
  timeoutMs?: number;
}

/** Keeps `checkDetail` readable when a stub breaks a whole suite. */
const MAX_NAMED_FAILURES = 4;

const ANSI_PATTERN = /\u001b\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

/**
 * Execution-based grading for code tasks: run the feature's existing
 * vitest files against the sandbox, host-side, AFTER the agent finished
 * (no arm ever sees runnable tooling — the agent's shell stays restricted).
 *
 * The graded surface (test files + configs) is restored from the sandbox's
 * initial commit first, so an agent cannot pass by editing the tests. The
 * host's node_modules is symlinked in for the child run only; pnpm's
 * symlink farm realpaths into the host store, and sandbox tests import
 * source relatively, so resolution stays correct from a foreign directory.
 * Benign side effect: the child writes its cache to the host's
 * node_modules/.vite through the symlink — fine while checks run
 * sequentially (they do).
 */
export function checkTests(
  testFiles: readonly string[],
  opts: CheckTestsOptions = {},
): (ctx: CheckCtx) => Promise<CheckResult> {
  return async (ctx) => {
    const vitestBin = join(ctx.repoRoot, "node_modules", "vitest", "vitest.mjs");
    try {
      await access(vitestBin);
    } catch {
      return { pass: false, detail: "host node_modules missing — run pnpm install" };
    }

    await execa(
      "git",
      ["checkout", "--", ...testFiles, "vitest.config.ts", "package.json", "tsconfig.json"],
      { cwd: ctx.sandboxDir },
    );

    const link = join(ctx.sandboxDir, "node_modules");
    await rm(link, { recursive: true, force: true });
    await symlink(join(ctx.repoRoot, "node_modules"), link, "dir");

    try {
      const res = await execa(
        process.execPath,
        [vitestBin, "run", ...testFiles],
        {
          cwd: ctx.sandboxDir,
          timeout: opts.timeoutMs ?? 120_000,
          reject: false,
          // Scrub the outer vitest's env so the child run is clean.
          env: {
            VITEST: undefined,
            VITEST_MODE: undefined,
            VITEST_POOL_ID: undefined,
            VITEST_WORKER_ID: undefined,
            TEST: undefined,
            NODE_ENV: undefined,
            FORCE_COLOR: "0",
          },
        },
      );
      if (res.exitCode === 0) return { pass: true };
      // vitest colors its output even under FORCE_COLOR=0, and raw escapes
      // corrupt both the report tables and any regex over the text.
      const out = stripAnsi(`${res.stdout}\n${res.stderr}`);
      const summary =
        /Tests\s+[^\n]*/.exec(out)?.[0]?.trim() ??
        (res.timedOut ? "vitest timed out" : `vitest exit ${String(res.exitCode)}`);
      // Name the failing tests: the summary line alone says how many broke,
      // never which behavior, which is the part a corpus finding turns on.
      const failed = [...out.matchAll(/^\s*(?:FAIL|×)\s+(.+?)\s*$/gm)]
        .map((m) => m[1].trim())
        .filter((name, i, all) => all.indexOf(name) === i)
        .slice(0, MAX_NAMED_FAILURES);
      const detail = failed.length > 0 ? `${summary} — ${failed.join("; ")}` : summary;
      return { pass: false, detail };
    } finally {
      await rm(link, { recursive: true, force: true });
    }
  };
}
