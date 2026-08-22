import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { basename, join } from "node:path";
import { generateReport } from "./src/report-gen.js";
import type { EvalRunSummary } from "./src/types.js";

/**
 * Report generator CLI: turns a run's summary.json into a committed
 * markdown report plus a provenance copy of the summary.
 *
 *   pnpm eval:report -- --run eval/results/run-<timestamp>
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

async function main(): Promise<number> {
  const { values } = parseArgs({
    // pnpm forwards the "--" separator itself; tolerate it as a positional.
    allowPositionals: true,
    options: {
      run: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });

  if (values.help || !values.run) {
    process.stdout.write(
      "Usage: pnpm eval:report -- --run <run-dir> [--out <reports-dir>]\n",
    );
    return values.help ? 0 : 1;
  }

  const summaryPath = join(values.run, "summary.json");
  const summary = JSON.parse(await readFile(summaryPath, "utf8")) as EvalRunSummary;
  if (summary.schemaVersion !== 1) {
    throw new Error(`unsupported summary schemaVersion: ${String(summary.schemaVersion)}`);
  }
  if (!summary.finishedAt) {
    process.stderr.write("warning: run did not finish — reporting partial results\n");
  }

  const outDir = values.out ?? join(repoRoot, "eval", "reports");
  await mkdir(outDir, { recursive: true });
  const date = summary.spec.startedAt.slice(0, 10);
  const name = `${date}-${summary.spec.backend}-${summary.spec.modelKey}`;

  const reportPath = join(outDir, `${name}.md`);
  await writeFile(reportPath, generateReport(summary));
  await copyFile(summaryPath, join(outDir, `${name}.summary.json`));

  process.stdout.write(`wrote ${reportPath} and ${basename(name)}.summary.json\n`);
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
