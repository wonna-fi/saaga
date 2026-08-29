import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execa } from "execa";
import { evalArgv } from "./src/argv.js";
import { createAgent, resolveModel, type Backend } from "../src/cli/backend.js";
import { TASK_SET_VERSION, selectTasks, validateRegistry } from "./src/registry.js";
import { runEval } from "./src/runner.js";
import { generateReport } from "./src/report-gen.js";
import { ALL_CONDITIONS, type ConditionId, type RunSpec } from "./src/types.js";

/**
 * Eval runner CLI. Not part of the shipped package — run from the repo:
 *
 *   pnpm eval -- --conditions no-docs,saaga-docs --reps 2
 *   pnpm eval -- --tasks defect/* --reps 1 --model low     # cheap pilot
 *   pnpm eval -- --dry-run                                 # print the matrix
 *
 * Real runs invoke a real agent CLI and spend tokens. The CI-safe path is
 * the vitest suite (eval/harness.test.ts), which injects the fake agent.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const USAGE = `Usage: pnpm eval -- [options]

Options:
  --conditions <csv>   no-docs, saaga-docs, docs-only, openwiki (default: no-docs,saaga-docs)
  --reps <n>           Repetitions per condition (default: 2)
  --tasks <csv>        Task ids or "defect/*" / "neutral/*" (default: all)
  --backend <name>     Agent backend (default: claude)
  --model <key>        Model key low|medium|high (default: medium)
  --rev <rev>          Git rev to export sandboxes from (default: HEAD)
  --openwiki-dir <dir> Pre-generated wiki for the openwiki condition
  --out <dir>          Run directory (default: eval/results/run-<timestamp>)
  --dry-run            Print the run matrix and exit
  --help               Show this help
`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: evalArgv(),
    options: {
      conditions: { type: "string", default: "no-docs,saaga-docs" },
      reps: { type: "string", default: "2" },
      tasks: { type: "string" },
      backend: { type: "string", default: "claude" },
      model: { type: "string", default: "medium" },
      rev: { type: "string", default: "HEAD" },
      "openwiki-dir": { type: "string" },
      out: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  validateRegistry();

  const conditions = values.conditions.split(",").map((c) => c.trim()) as ConditionId[];
  for (const condition of conditions) {
    if (!ALL_CONDITIONS.includes(condition)) {
      throw new Error(`unknown condition '${condition}' (allowed: ${ALL_CONDITIONS.join(", ")})`);
    }
  }
  const reps = Number(values.reps);
  if (!Number.isInteger(reps) || reps < 1) throw new Error(`invalid --reps '${values.reps}'`);
  if (reps < 2) {
    process.stderr.write(
      "warning: fewer than 2 reps per condition — the report will carry no spread\n",
    );
  }

  const tasks = selectTasks(values.tasks?.split(",").map((t) => t.trim()));
  const backend = values.backend as Backend;
  const model = resolveModel(backend, values.model);
  const rev = (
    await execa("git", ["-C", repoRoot, "rev-parse", values.rev])
  ).stdout.trim();

  const spec: RunSpec = {
    schemaVersion: 1,
    backend,
    model,
    modelKey: values.model,
    rev,
    conditions,
    reps,
    taskIds: tasks.map((t) => t.id),
    taskSetVersion: TASK_SET_VERSION,
    startedAt: new Date().toISOString(),
  };

  if (values["dry-run"]) {
    const lines: string[] = [];
    for (const task of tasks) {
      for (const condition of conditions) {
        if (task.appliesTo && !task.appliesTo.includes(condition)) {
          lines.push(`${task.id} · ${condition} · skipped (not applicable)`);
          continue;
        }
        for (let rep = 1; rep <= reps; rep++) {
          lines.push(`${task.id} · ${condition} · rep ${rep}`);
        }
      }
    }
    const runCount = lines.filter((l) => !l.endsWith("(not applicable)")).length;
    process.stdout.write(`rev: ${rev}\nbackend: ${backend} / ${model} (key: ${values.model})\n`);
    process.stdout.write(`matrix: ${tasks.length} tasks × ${conditions.length} conditions × ${reps} reps = ${runCount} agent runs\n\n`);
    process.stdout.write(lines.join("\n") + "\n");
    return 0;
  }

  const stamp = spec.startedAt.replace(/[:.]/g, "-");
  const outDir = values.out ?? join(repoRoot, "eval", "results", `run-${stamp}`);
  const agent = createAgent({ backend, model, ci: true });

  const summary = await runEval(spec, agent, tasks, {
    repoRoot,
    outDir,
    openwikiDir: values["openwiki-dir"],
    log: (message) => process.stdout.write(`${message}\n`),
  });

  const failed = summary.results.filter((r) => !r.pass).length;
  process.stdout.write(
    `\ndone: ${summary.results.length - failed}/${summary.results.length} runs passed\n` +
      `results: ${outDir}\n` +
      `report:  pnpm eval:report -- --run ${outDir}\n\n` +
      generateReport(summary),
  );
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
