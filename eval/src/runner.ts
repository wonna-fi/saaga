import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { AgentEvent } from "../../src/agent/events.js";
import type { Agent, AgentRunOpts } from "../../src/agent/types.js";
import { collectMetrics } from "./metrics.js";
import { createSandbox } from "./sandbox.js";
import {
  DEFAULT_TASK_TIMEOUT_MS,
  type CheckCtx,
  type EvalRunSummary,
  type EvalTask,
  type RunSpec,
  type TaskResult,
} from "./types.js";

/** Appended to every "answer" task so the convention lives in one place. */
export const ANSWER_INSTRUCTION =
  "Write your final answer to a file named ANSWER.md at the repository root.";

export interface RunEvalOptions {
  /** Repo whose tracked tree the sandboxes are exported from. */
  repoRoot: string;
  /** Run directory; spec.json, summary.json and logs/ land here. */
  outDir: string;
  openwikiDir?: string;
  /** Progress sink; defaults to silent (tests) — run.ts passes console.log. */
  log?: (message: string) => void;
}

/**
 * Execute the run matrix: task -> condition -> rep, deterministically.
 *
 * Every run gets a fresh condition-mutated sandbox. summary.json is
 * rewritten after each result so a crashed run keeps its partial data.
 * A harness-level failure (sandbox error, agent throw, timeout) records a
 * TaskResult with `error` set and pass=false instead of aborting the run.
 */
export async function runEval(
  spec: RunSpec,
  agent: Agent,
  tasks: readonly EvalTask[],
  opts: RunEvalOptions,
): Promise<EvalRunSummary> {
  const log = opts.log ?? (() => undefined);
  await mkdir(opts.outDir, { recursive: true });
  await writeFile(join(opts.outDir, "spec.json"), JSON.stringify(spec, null, 2) + "\n");

  const summary: EvalRunSummary = { schemaVersion: 1, spec, results: [] };

  for (const task of tasks) {
    for (const condition of spec.conditions) {
      for (let rep = 1; rep <= spec.reps; rep++) {
        const slug = task.id.replace("/", "--");
        const logFile = join(opts.outDir, "logs", condition, `${slug}--rep${rep}.ndjson`);
        await mkdir(dirname(logFile), { recursive: true });
        log(`${task.id} · ${condition} · rep ${rep}/${spec.reps}`);

        const result = await runOnce(task, condition, rep, spec.rev, agent, logFile, opts);
        summary.results.push(result);
        await writeSummary(opts.outDir, summary);
        log(
          `  ${result.pass ? "PASS" : "FAIL"} exit=${result.exitCode} ` +
            `${Math.round(result.metrics.elapsedMs / 1000)}s` +
            (result.error ? ` error=${result.error}` : ""),
        );
      }
    }
  }

  summary.finishedAt = new Date().toISOString();
  await writeSummary(opts.outDir, summary);
  return summary;
}

async function runOnce(
  task: EvalTask,
  condition: RunSpec["conditions"][number],
  rep: number,
  rev: string,
  agent: Agent,
  logFile: string,
  opts: RunEvalOptions,
): Promise<TaskResult> {
  const base: Omit<TaskResult, "exitCode" | "pass" | "metrics"> = {
    taskId: task.id,
    half: task.half,
    condition,
    rep,
    logFile: relative(opts.outDir, logFile),
  };

  let sandbox;
  try {
    sandbox = await createSandbox({
      repoRoot: opts.repoRoot,
      rev,
      condition,
      openwikiDir: opts.openwikiDir,
    });
  } catch (err) {
    return {
      ...base,
      exitCode: 1,
      pass: false,
      metrics: { elapsedMs: 0 },
      error: `sandbox: ${describe(err)}`,
    };
  }

  const t0 = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), task.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS);
  const events: AgentEvent[] = [];

  try {
    const prompt =
      task.kind === "answer" ? `${task.prompt}\n\n${ANSWER_INSTRUCTION}` : task.prompt;
    const agentOpts: AgentRunOpts = {
      cwd: sandbox.sandboxDir,
      signal: controller.signal,
      additionalDirs: [sandbox.runDir],
      permissions: {
        readRoots: [sandbox.sandboxDir],
        writeRoots: [sandbox.sandboxDir, sandbox.runDir],
        denyPaths: [],
        shell: "restricted",
      },
      logFile,
      onEvent: (event) => events.push(event),
    };

    const { exitCode } = await agent.run(prompt, agentOpts);
    const metrics = collectMetrics(events, Date.now() - t0);
    const check = await task.check(makeCheckCtx(sandbox.sandboxDir));
    return { ...base, exitCode, pass: check.pass, checkDetail: check.detail, metrics };
  } catch (err) {
    return {
      ...base,
      exitCode: 1,
      pass: false,
      metrics: collectMetrics(events, Date.now() - t0),
      error: describe(err),
    };
  } finally {
    clearTimeout(timeout);
    await sandbox.cleanup();
  }
}

function makeCheckCtx(sandboxDir: string): CheckCtx {
  const read = (path: string) => readFile(path, "utf8").catch(() => "");
  return {
    sandboxDir,
    readAnswer: () => read(join(sandboxDir, "ANSWER.md")),
    readFile: (rel: string) => read(join(sandboxDir, rel)),
  };
}

async function writeSummary(outDir: string, summary: EvalRunSummary): Promise<void> {
  await writeFile(join(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
