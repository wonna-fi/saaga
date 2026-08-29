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
      if (task.appliesTo && !task.appliesTo.includes(condition)) {
        log(`${task.id} · ${condition} · skipped (not applicable)`);
        continue;
      }
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
      prepare: task.prepare?.bind(task),
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
    metrics.docsReads = await countDocsReads(logFile);
    const check = await task.check(makeCheckCtx(sandbox.sandboxDir, opts.repoRoot));
    if (!check.pass) {
      await saveArtifacts(task, sandbox.sandboxDir, join(opts.outDir, "artifacts", condition, `${task.id.replace("/", "--")}--rep${rep}`));
    }
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

/**
 * Count corpus files the agent actually READ, from a run's transcript.
 *
 * Pairs each corpus-path tool call with its result and counts only the
 * ones that succeeded: a weaker model guessing a `saaga-docs/...` path
 * that does not exist would otherwise be counted as corpus access and
 * break the no-docs negative control (observed at haiku tier). Still a
 * lower bound — corpus text reached via Grep output is never counted.
 *
 * undefined when the transcript is missing/unreadable (fake-agent runs
 * write no log), so "unknown" stays distinct from a measured zero.
 */
export async function countDocsReads(logFile: string): Promise<number | undefined> {
  let text: string;
  try {
    text = await readFile(logFile, "utf8");
  } catch {
    return undefined;
  }

  const corpusCalls = new Set<string>();
  let reads = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const message = (obj as { message?: unknown }).message;
    if (typeof message !== "object" || message === null) continue;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;

    for (const block of content as Record<string, unknown>[]) {
      if (block.type === "tool_use" && typeof block.id === "string") {
        const input = (block.input ?? {}) as Record<string, unknown>;
        const path = input.file_path;
        if (typeof path === "string" && path.includes("saaga-docs/")) {
          corpusCalls.add(block.id);
        }
      }
      if (
        block.type === "tool_result" &&
        typeof block.tool_use_id === "string" &&
        corpusCalls.has(block.tool_use_id) &&
        block.is_error !== true
      ) {
        reads++;
      }
    }
  }
  return reads;
}

/**
 * On a failure, keep what the agent produced: the sandbox is deleted
 * moments later, and without this the only record of the agent's actual
 * implementation is buried in the NDJSON transcript. Code tasks save
 * their targetFiles; answer tasks save ANSWER.md. Best-effort — a
 * missing file (the agent never wrote one) is itself the finding.
 */
async function saveArtifacts(
  task: EvalTask,
  sandboxDir: string,
  destDir: string,
): Promise<void> {
  const wanted = task.kind === "code" ? (task.targetFiles ?? []) : ["ANSWER.md"];
  for (const rel of wanted) {
    const content = await readFile(join(sandboxDir, rel), "utf8").catch(() => undefined);
    if (content === undefined) continue;
    const dest = join(destDir, rel);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content);
  }
}

function makeCheckCtx(sandboxDir: string, repoRoot: string): CheckCtx {
  const read = (path: string) => readFile(path, "utf8").catch(() => "");
  return {
    sandboxDir,
    repoRoot,
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
