import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { NonResumableError } from "../../src/engine/errors.js";
import { checkPlanBudgetScript } from "../../src/scripts/check-plan-budget.js";

const PHASES = `---
phases:
  - number: 0
    title: "Setup"
  - number: 1
    title: "Core"
---
`;

/** A plan authoring `count` documents of `linesEach` lines apiece. */
function planWith(count: number, linesEach: number): string {
  const body = Array.from(
    { length: count },
    (_, i) =>
      `- concepts/d${i}.md — Core, ${linesEach} lines\n` +
      `- concepts/d${i}.md — owns: thing ${i}; references: none\n`,
  ).join("");
  return `${PHASES}\n## Phase 1\n\n${body}`;
}

/**
 * An app with real source, so the ceilings are nonzero. 8000 source lines
 * yields a 19-document / 2000-line ceiling.
 */
async function tmpEnv(plan: string, sourceLines = 8000) {
  const app = await mkdtemp(join(tmpdir(), "saaga-gate-"));
  await mkdir(join(app, "src"), { recursive: true });
  await writeFile(join(app, "src", "a.ts"), "x\n".repeat(sourceLines), "utf8");

  const planPath = join(app, "plan.md");
  await writeFile(planPath, plan, "utf8");

  return { app, plan: planPath, report: join(app, "run", "budget.md") };
}

function args(env: { app: string; plan: string; report: string }, mode: string) {
  return {
    app_dir: env.app,
    docs_dir: "saaga-docs",
    plan: env.plan,
    report_path: env.report,
    mode,
  };
}

describe("check-plan-budget", () => {
  test("an in-budget plan passes in both modes", async () => {
    const env = await tmpEnv(planWith(5, 100));

    for (const mode of ["report", "enforce"]) {
      const result = await checkPlanBudgetScript(args(env, mode), { cwd: env.app });
      expect(result.status, mode).toBe("PASS");
      expect(result.docs, mode).toBe(5);
      expect(result.doc_ceiling, mode).toBe(19);
    }
  });

  // The loop reads ${budget.status}; throwing here would abort the run instead
  // of retrying it.
  test("report mode returns a verdict for an over-budget plan and does not throw", async () => {
    const env = await tmpEnv(planWith(40, 100));
    const result = await checkPlanBudgetScript(args(env, "report"), { cwd: env.app });

    expect(result.status).toBe("OVER");
    expect(result.docs).toBe(40);
    expect(result.reasons).toContain("over-doc-count");
  });

  test("enforce mode fails the run, naming the totals and the recovery", async () => {
    const env = await tmpEnv(planWith(40, 100));

    await expect(
      checkPlanBudgetScript(args(env, "enforce"), { cwd: env.app }),
    ).rejects.toThrow(/40 documents against a ceiling of 19/);

    await expect(
      checkPlanBudgetScript(args(env, "enforce"), { cwd: env.app }),
    ).rejects.toThrow(/delete saaga-docs\/ and run 'saaga run init' again/);
  });

  // Resuming replays the journaled loop and re-throws here, so the error says
  // so — and is typed non-resumable, which is what suppresses the CLI's
  // generic "To resume:" hint that would otherwise contradict it.
  test("the failure is non-resumable and says so", async () => {
    const env = await tmpEnv(planWith(40, 100));

    await expect(
      checkPlanBudgetScript(args(env, "enforce"), { cwd: env.app }),
    ).rejects.toThrow(/Resuming replays the same plan/);

    await expect(
      checkPlanBudgetScript(args(env, "enforce"), { cwd: env.app }),
    ).rejects.toThrow(NonResumableError);
  });

  test("ceilings the plan declares for itself are ignored", async () => {
    const env = await tmpEnv(
      `${PHASES}\n## Phase 1\n\nDocument ceiling: 500. Line ceiling: 100000.\n\n` +
        planWith(40, 100).split("## Phase 1\n\n")[1],
    );

    const result = await checkPlanBudgetScript(args(env, "report"), { cwd: env.app });
    expect(result.status).toBe("OVER");
    expect(result.doc_ceiling).toBe(19);
  });

  test("conventions count toward the ceiling at the fixed cap", async () => {
    const env = await tmpEnv(
      `${PHASES}\n## Phase 1\n\n` +
        "- concepts/a.md — Core, 100 lines\n" +
        "- concepts/a.md — owns: a; references: none\n" +
        "## Phase 2\n\n- saaga-docs/conventions/naming.md\n",
    );

    const result = await checkPlanBudgetScript(args(env, "report"), { cwd: env.app });
    expect(result.docs).toBe(2);
    expect(result.lines).toBe(120);
  });

  test("an unbudgeted document is charged, not skipped", async () => {
    const env = await tmpEnv(
      `${PHASES}\n## Phase 1\n\n` +
        "- concepts/a.md — Core, 100 lines\n" +
        "- concepts/a.md — owns: a; references: none\n" +
        "- concepts/b.md — owns: b; references: none\n",
    );

    const warnings: string[] = [];
    const result = await checkPlanBudgetScript(args(env, "report"), {
      cwd: env.app,
      warn: (m) => warnings.push(m),
    });

    expect(result.docs).toBe(2);
    expect(result.lines).toBe(300);
    expect(warnings.join("\n")).toContain("concepts/b.md");
  });

  test("a plan the parser cannot read is never a pass", async () => {
    const env = await tmpEnv(`${PHASES}\n# Plan body\n`);

    const result = await checkPlanBudgetScript(args(env, "report"), { cwd: env.app });
    expect(result.status).toBe("UNPARSEABLE");

    await expect(
      checkPlanBudgetScript(args(env, "enforce"), { cwd: env.app }),
    ).rejects.toThrow(/could not be read/);
  });

  // An unreadable plan and an oversized one need opposite responses, so the
  // report must not steer a retry toward cutting documents.
  test("the unparseable report asks for the format, not fewer documents", async () => {
    const env = await tmpEnv(`${PHASES}\n# Plan body\n`);
    await checkPlanBudgetScript(args(env, "report"), { cwd: env.app });

    const report = await readFile(env.report, "utf8");
    expect(report).toContain("Status: **UNPARSEABLE**");
    expect(report).toContain("a **format** problem, not a size problem");
    expect(report).toContain("<path> — <Core|Supporting|Peripheral>, <N> lines");
    expect(report).not.toContain("Cut document **count** first");
  });

  test("a no-source pass says why, so it is not mistaken for merit", async () => {
    const env = await tmpEnv(planWith(50, 900), 0);
    const warnings: string[] = [];

    await checkPlanBudgetScript(args(env, "report"), {
      cwd: env.app,
      warn: (m) => warnings.push(m),
    });

    expect(warnings.join("\n")).toContain("no source files were measured");
  });

  // This is what keeps the fake-agent CLI fixtures green: their app is a
  // single README.md, so there is no ceiling to hold them to.
  test("a repository with no source passes whatever the plan says", async () => {
    const env = await tmpEnv(planWith(50, 900), 0);

    const result = await checkPlanBudgetScript(args(env, "enforce"), { cwd: env.app });
    expect(result.status).toBe("PASS");
    expect(result.reasons).toBe("no-measurable-source");
  });

  test("the report is written in both modes, including before a failure", async () => {
    const env = await tmpEnv(planWith(40, 100));

    await checkPlanBudgetScript(args(env, "report"), { cwd: env.app });
    const afterReport = await readFile(env.report, "utf8");
    expect(afterReport).toContain("Status: **OVER**");
    expect(afterReport).toContain("Cut document **count** first");

    await expect(
      checkPlanBudgetScript(args(env, "enforce"), { cwd: env.app }),
    ).rejects.toThrow();
    expect(await readFile(env.report, "utf8")).toContain("Status: **OVER**");
  });

  test("wiring faults throw in both modes", async () => {
    const env = await tmpEnv(planWith(1, 10));

    await expect(
      checkPlanBudgetScript({ ...args(env, "report"), plan: "" }, { cwd: env.app }),
    ).rejects.toThrow(/'plan' arg is required/);

    await expect(
      checkPlanBudgetScript({ ...args(env, "report"), mode: "sideways" }, { cwd: env.app }),
    ).rejects.toThrow(/'mode' must be "report" or "enforce"/);

    await expect(
      checkPlanBudgetScript({ ...args(env, "report"), plan: "nope.md" }, { cwd: env.app }),
    ).rejects.toThrow(/cannot read the plan/);
  });
});
