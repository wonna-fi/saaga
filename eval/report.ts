import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { generateComparison, generateReport, reportBaseName } from "./src/report-gen.js";
import { countDocsReads } from "./src/runner.js";
import type { EvalRunSummary } from "./src/types.js";

/**
 * Report generator CLI.
 *
 * Single run -> committed markdown report + provenance summary copy:
 *   pnpm eval:report --run eval/results/run-<timestamp>
 *
 * Two runs of the identical task set -> delta report (the regeneration-
 * milestone instrument; old corpus as base, new corpus as candidate):
 *   pnpm eval:report --base <run-dir|summary.json> --candidate <run-dir|summary.json>
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const USAGE =
  "Usage: pnpm eval:report --run <run-dir> [--out <dir>]\n" +
  "       pnpm eval:report --base <run-dir|summary.json> --candidate <run-dir|summary.json> [--out <dir>]\n";

async function loadSummary(path: string): Promise<EvalRunSummary> {
  const file = path.endsWith(".json") ? path : join(path, "summary.json");
  const summary = JSON.parse(await readFile(file, "utf8")) as EvalRunSummary;
  if (summary.schemaVersion !== 1) {
    throw new Error(`unsupported summary schemaVersion in ${file}: ${String(summary.schemaVersion)}`);
  }
  return summary;
}

/**
 * Older summaries predate the docsReads metric; recover it from the run
 * directory's transcripts when they are still on disk. Deterministic
 * (same grep the runner performs), so the enriched copy stays faithful.
 */
async function backfillDocsReads(summary: EvalRunSummary, runDir: string): Promise<void> {
  for (const result of summary.results) {
    if (typeof result.metrics.docsReads === "number") continue;
    const reads = await countDocsReads(join(runDir, result.logFile));
    if (typeof reads === "number") result.metrics.docsReads = reads;
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    // pnpm forwards the "--" separator itself; tolerate it as a positional.
    allowPositionals: true,
    options: {
      run: { type: "string" },
      base: { type: "string" },
      candidate: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const outDir = values.out ?? join(repoRoot, "eval", "reports");

  if (values.base || values.candidate) {
    if (!values.base || !values.candidate) {
      process.stderr.write("comparison needs both --base and --candidate\n" + USAGE);
      return 1;
    }
    const base = await loadSummary(values.base);
    const candidate = await loadSummary(values.candidate);
    if (!values.base.endsWith(".json")) await backfillDocsReads(base, values.base);
    if (!values.candidate.endsWith(".json")) await backfillDocsReads(candidate, values.candidate);

    await mkdir(outDir, { recursive: true });
    const name = `compare-${reportBaseName(base.spec)}-vs-${reportBaseName(candidate.spec)}`;
    const reportPath = join(outDir, `${name}.md`);
    await writeFile(reportPath, generateComparison(base, candidate));
    process.stdout.write(`wrote ${reportPath}\n`);
    return 0;
  }

  if (!values.run) {
    process.stdout.write(USAGE);
    return 1;
  }

  const summary = await loadSummary(values.run);
  if (!summary.finishedAt) {
    process.stderr.write("warning: run did not finish — reporting partial results\n");
  }
  await backfillDocsReads(summary, values.run);

  await mkdir(outDir, { recursive: true });
  const name = reportBaseName(summary.spec);
  const reportPath = join(outDir, `${name}.md`);
  await writeFile(reportPath, generateReport(summary));
  // The provenance copy carries the (deterministically) backfilled metrics
  // so the committed pair regenerates the exact same tables.
  const summaryOut = join(outDir, `${name}.summary.json`);
  if (summary.results.some((r) => typeof r.metrics.docsReads === "number")) {
    await writeFile(summaryOut, JSON.stringify(summary, null, 2) + "\n");
  } else {
    await copyFile(join(values.run, "summary.json"), summaryOut);
  }

  process.stdout.write(`wrote ${reportPath} and ${name}.summary.json\n`);
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
