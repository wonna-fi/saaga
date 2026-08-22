import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execa } from "execa";
import { afterAll, describe, expect, test } from "vitest";
import { FakeAgent } from "../src/agent/fake-agent.js";
import { EVAL_TASKS } from "./src/registry.js";
import { ANSWER_INSTRUCTION, runEval } from "./src/runner.js";
import { generateReport } from "./src/report-gen.js";
import { checkAnswer } from "./src/checks.js";
import type { EvalRunSummary, EvalTask, RunSpec } from "./src/types.js";

/**
 * CI smoke path: the full pipeline — registry -> sandbox -> condition
 * isolation -> agent -> check -> summary -> report — with the FakeAgent,
 * spending zero tokens.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const cleanups: string[] = [];

afterAll(async () => {
  await Promise.all(cleanups.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeOutDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "saaga-eval-out-"));
  cleanups.push(dir);
  return dir;
}

function makeSpec(over: Partial<RunSpec>): RunSpec {
  return {
    schemaVersion: 1,
    backend: "claude",
    model: "sonnet",
    modelKey: "medium",
    rev: "HEAD",
    conditions: ["no-docs", "saaga-docs"],
    reps: 2,
    taskIds: [],
    startedAt: new Date().toISOString(),
    ...over,
  };
}

function syntheticTask(slug: string, half: "defect" | "neutral"): EvalTask {
  return {
    id: `${half}/${slug}`,
    half,
    title: slug,
    kind: "answer",
    prompt: `synthetic task ${slug}`,
    check: checkAnswer({ must: [/correct/] }),
  };
}

describe("eval pipeline with the fake agent", () => {
  test("runs the full matrix, isolates conditions, and reports metrics", async () => {
    const tasks = [
      syntheticTask("pass-a", "defect"),
      syntheticTask("fail-b", "defect"),
      syntheticTask("pass-c", "neutral"),
      syntheticTask("fail-d", "neutral"),
    ];
    const spec = makeSpec({ taskIds: tasks.map((t) => t.id) });

    // Observations captured from INSIDE the sandbox while it exists.
    const seen: { hasDocs: boolean; routing: boolean; commits: number; answerTold: boolean }[] = [];
    const observe = async (cwd: string, prompt: string) => {
      const agentsMd = await readFile(join(cwd, "AGENTS.md"), "utf8");
      const log = await execa("git", ["log", "--oneline"], { cwd });
      seen.push({
        hasDocs: existsSync(join(cwd, "saaga-docs")),
        routing: agentsMd.includes("## Documentation"),
        commits: log.stdout.trim().split("\n").length,
        answerTold: prompt.includes(ANSWER_INSTRUCTION),
      });
    };

    const scenario = (verdict: string) => ({
      exitCode: 0,
      effect: async (opts: { cwd: string; onEvent?: (e: never) => void }, prompt: string) => {
        await observe(opts.cwd, prompt);
        await writeFile(join(opts.cwd, "ANSWER.md"), verdict);
        (opts.onEvent as ((e: unknown) => void) | undefined)?.({
          kind: "usage",
          turns: 3,
          inputTokens: 1200,
          outputTokens: 300,
        });
      },
    });

    const agent = new FakeAgent({
      "synthetic task pass-a": scenario("correct"),
      "synthetic task fail-b": scenario("wrong"),
      "synthetic task pass-c": scenario("correct"),
      "synthetic task fail-d": scenario("wrong"),
    });

    const outDir = await makeOutDir();
    const summary = await runEval(spec, agent, tasks, { repoRoot, outDir });

    // 4 tasks x 2 conditions x 2 reps.
    expect(summary.results).toHaveLength(16);
    expect(summary.finishedAt).toBeTruthy();

    // Condition isolation, observed live inside each sandbox: run order is
    // task -> condition -> rep, so per task 2 no-docs runs then 2 saaga-docs.
    expect(seen).toHaveLength(16);
    for (let i = 0; i < seen.length; i++) {
      const noDocs = i % 4 < 2;
      expect(seen[i].hasDocs).toBe(!noDocs);
      expect(seen[i].routing).toBe(!noDocs);
      expect(seen[i].commits).toBe(1);
      expect(seen[i].answerTold).toBe(true);
    }

    // Scripted pass/fail carried through the checks.
    for (const r of summary.results) {
      expect(r.pass).toBe(r.taskId.includes("pass-"));
      expect(r.error).toBeUndefined();
      expect(r.metrics.turns).toBe(3);
      expect(r.metrics.inputTokens).toBe(1200);
      expect(r.metrics.outputTokens).toBe(300);
      expect(r.metrics.elapsedMs).toBeGreaterThanOrEqual(0);
    }

    // Incremental persistence: summary.json on disk matches the return value.
    const onDisk = JSON.parse(
      await readFile(join(outDir, "summary.json"), "utf8"),
    ) as EvalRunSummary;
    expect(onDisk.results).toHaveLength(16);
    expect(onDisk.spec.rev).toBe("HEAD");
    expect(existsSync(join(outDir, "spec.json"))).toBe(true);
    expect(existsSync(join(outDir, "logs", "no-docs"))).toBe(true);

    // Report: halves separate, fractions and spread present.
    const report = generateReport(summary);
    expect(report).toContain("## Neutral half");
    expect(report).toContain("## Defect half");
    expect(report).toContain("| defect/pass-a | 2/2 | 2/2 |");
    expect(report).toContain("| neutral/fail-d | 0/2 | 0/2 |");
    expect(report).toMatch(/\| no-docs \| 2\/4 \| 3 \| 1200 \| 300 \| \d+s \|/);
  }, 120_000);

  test("a scenario miss becomes a recorded error, not a crash", async () => {
    const task = syntheticTask("unmatched", "neutral");
    const spec = makeSpec({ conditions: ["saaga-docs"], reps: 1, taskIds: [task.id] });
    const outDir = await makeOutDir();

    const summary = await runEval(spec, new FakeAgent({}), [task], { repoRoot, outDir });
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0].pass).toBe(false);
    expect(summary.results[0].error).toContain("no scenario matched");
  }, 60_000);

  test("a real registry task runs end-to-end and its committed check passes", async () => {
    const task = EVAL_TASKS.find((t) => t.id === "neutral/anchor-model-defaults");
    expect(task).toBeDefined();
    if (!task) return;

    const agent = new FakeAgent({
      "built-in default model strings": {
        exitCode: 0,
        effect: async (opts) => {
          await writeFile(
            join(opts.cwd, "ANSWER.md"),
            "low: haiku, medium: sonnet, high: opus\n",
          );
        },
      },
    });

    const spec = makeSpec({ conditions: ["saaga-docs"], reps: 1, taskIds: [task.id] });
    const outDir = await makeOutDir();
    const summary = await runEval(spec, agent, [task], { repoRoot, outDir });
    expect(summary.results[0].pass).toBe(true);
    expect(summary.results[0].error).toBeUndefined();
  }, 60_000);

  test("a committed check rejects a wrong answer", async () => {
    const task = EVAL_TASKS.find((t) => t.id === "defect/shell-policy-values");
    expect(task).toBeDefined();
    if (!task) return;

    const dir = await makeOutDir();
    await writeFile(join(dir, "ANSWER.md"), "The values are none and read-only-git.\n");
    const read = (p: string) => readFile(p, "utf8").catch(() => "");
    const result = await task.check({
      sandboxDir: dir,
      readAnswer: () => read(join(dir, "ANSWER.md")),
      readFile: (rel) => read(join(dir, rel)),
    });
    expect(result.pass).toBe(false);
    expect(result.detail).toBeTruthy();
  });
});
