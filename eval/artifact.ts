import { readdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { evalArgv } from "./src/argv.js";
import { renderArtifact, toArtifactData } from "./src/artifact-gen.js";
import { EVAL_TASKS } from "./src/registry.js";
import type { EvalRunSummary } from "./src/types.js";

/**
 * Visual readout generator: committed summaries -> one self-contained HTML
 * page with a single-run view and a base-vs-candidate compare view.
 *
 *   pnpm eval:artifact                       # every committed report
 *   pnpm eval:artifact -- --out /tmp/x.html
 *   pnpm eval:artifact -- --summary a.json --summary b.json
 *
 * The page is generated, never edited: after the corpus is regenerated,
 * re-running this rebuilds it with the new run alongside the old ones.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const reportsDir = join(repoRoot, "eval", "reports");
const templatePath = join(repoRoot, "eval", "artifact", "template.html");

const USAGE = `Usage: pnpm eval:artifact -- [options]

Options:
  --summary <file>   Summary json to embed (repeatable; default: every
                     *.summary.json under eval/reports)
  --out <file>       Output html (default: eval/reports/eval-readout.html)
  --help             Show this help
`;

async function collectSummaryPaths(explicit: string[] | undefined): Promise<string[]> {
  if (explicit && explicit.length > 0) return explicit;
  const entries = await readdir(reportsDir);
  return entries
    .filter((name) => name.endsWith(".summary.json"))
    .sort()
    .map((name) => join(reportsDir, name));
}

async function load(path: string): Promise<EvalRunSummary> {
  const summary = JSON.parse(await readFile(path, "utf8")) as EvalRunSummary;
  if (summary.schemaVersion !== 1) {
    throw new Error(`unsupported summary schemaVersion in ${path}: ${String(summary.schemaVersion)}`);
  }
  return summary;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: evalArgv(),
    options: {
      summary: { type: "string", multiple: true },
      out: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const paths = await collectSummaryPaths(values.summary);
  if (paths.length === 0) {
    process.stderr.write(`no summaries found in ${reportsDir}\n`);
    return 1;
  }

  const summaries = await Promise.all(paths.map(load));
  // Task kind lives in the registry, not the summary: a "code" badge in
  // the matrix tells a reader which cells are execution-graded.
  const kinds = new Map(EVAL_TASKS.map((t) => [t.id, t.kind]));
  const template = await readFile(templatePath, "utf8");
  const html = renderArtifact(template, toArtifactData(summaries, kinds));

  const out = values.out ?? join(reportsDir, "eval-readout.html");
  await writeFile(out, html);
  process.stdout.write(`wrote ${out} (${String(summaries.length)} runs)\n`);
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
