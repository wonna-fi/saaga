import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { posix, resolve } from "node:path";
import { listDocFiles } from "../docs/link-graph.js";
import {
  validateCorpus,
  type DocInput,
  type DocProblem,
  type ValidationReport,
} from "../docs/validate.js";
import type { ScriptContext } from "./registry.js";

export interface ValidateDocsArgs {
  /** Absolute path to the application directory. */
  app_dir: string;
  /** Name of the documentation directory (e.g. `"saaga-docs"`). */
  docs_dir: string;
  /** Directory the report is written to. The report path is `<output_dir>/doc-validation.md`. */
  output_dir: string;
}

export interface ValidateDocsResult {
  /** Absolute path to the written report, or `""` when there was no corpus to check. */
  report_path: string;
  files_checked: number;
  broken_links: number;
  invalid_diagrams: number;
  orphans: number;
}

/** Name of the report written into the run directory. */
export const REPORT_FILE = "doc-validation.md";

/** Orphan warnings printed before the rest are left to the report. */
const MAX_WARNINGS = 10;

/**
 * Last step of the documentation flows: checks the generated corpus for the
 * defects that are decidable in code.
 *
 * Link integrity, diagram validity, and reachability used to be guaranteed only
 * by the verify agent reading the docs — a model-dependent promise costing
 * agent sessions per slice. They are structural facts, so they belong here,
 * which also frees the verify prompt for the semantic rot only a model catches.
 *
 * Broken links and invalid diagrams fail the flow; orphans only warn, because a
 * document that nothing links to is still correct, just unreachable, and the
 * navigation layer that fixes it is generated separately.
 *
 * Runs *after* the baseline and format stamp are written. Failing earlier would
 * abort the flow leaving the corpus unbaselined and unstamped, which makes the
 * next run refuse to start — the corpus is written first, the verdict comes
 * after.
 */
export async function validateDocs(
  args: ValidateDocsArgs,
  ctx: ScriptContext,
): Promise<ValidateDocsResult> {
  const appDir = args.app_dir;
  if (!appDir) {
    throw new Error("validate-docs: 'app_dir' arg is required");
  }
  const docsDir = args.docs_dir;
  if (!docsDir) {
    throw new Error("validate-docs: 'docs_dir' arg is required");
  }
  const outputDir = args.output_dir;
  if (!outputDir) {
    throw new Error("validate-docs: 'output_dir' arg is required");
  }

  const docsRoot = resolve(appDir, docsDir);
  const paths = await listDocFiles(docsRoot);

  // An absent or empty corpus is not a structural failure: `init` creates one,
  // and every flow must stay runnable against a greenfield project.
  if (paths.length === 0) {
    return {
      report_path: "",
      files_checked: 0,
      broken_links: 0,
      invalid_diagrams: 0,
      orphans: 0,
    };
  }

  const docs: DocInput[] = [];
  for (const path of paths) {
    docs.push({ path, content: await readFile(resolve(docsRoot, path), "utf8") });
  }

  const report = await validateCorpus(docs, {
    exists: (relPath) => fileExists(resolve(docsRoot, relPath)),
  });

  await mkdir(outputDir, { recursive: true });
  const reportPath = resolve(outputDir, REPORT_FILE);
  await writeFile(reportPath, renderReport(report, docsDir), "utf8");

  for (const orphan of report.orphans.slice(0, MAX_WARNINGS)) {
    ctx.warn?.(`orphan document: ${posix.join(docsDir, orphan.file)}`);
  }
  const hidden = report.orphans.length - MAX_WARNINGS;
  if (hidden > 0) {
    ctx.warn?.(`…and ${hidden} more orphan(s), see ${reportPath}`);
  }

  const fatal = report.brokenLinks.length + report.invalidMermaid.length;
  if (fatal > 0) {
    throw new Error(
      `validate-docs: ${docsDir}/ has ${count(report.brokenLinks.length, "broken link")} ` +
        `and ${count(report.invalidMermaid.length, "invalid Mermaid diagram")}. ` +
        `See the report at ${reportPath}.`,
    );
  }

  return {
    report_path: reportPath,
    files_checked: report.filesChecked,
    broken_links: report.brokenLinks.length,
    invalid_diagrams: report.invalidMermaid.length,
    orphans: report.orphans.length,
  };
}

function renderReport(report: ValidationReport, docsDir: string): string {
  const lines = [
    "# Documentation Validation",
    "",
    `Checked ${count(report.filesChecked, "document")} under \`${docsDir}/\`.`,
    "",
    `Summary: ${count(report.brokenLinks.length, "broken link")}, ` +
      `${count(report.invalidMermaid.length, "invalid diagram")}, ` +
      `${count(report.orphans.length, "orphan")}.`,
    "",
  ];

  section(lines, "Broken Links", report.brokenLinks);
  section(lines, "Invalid Mermaid Diagrams", report.invalidMermaid);
  section(lines, "Orphan Documents", report.orphans);

  return lines.join("\n") + "\n";
}

function section(lines: string[], title: string, problems: DocProblem[]): void {
  lines.push(`## ${title}`, "");
  if (problems.length === 0) {
    lines.push("_None_", "");
    return;
  }
  for (const p of problems) {
    const where = p.line === undefined ? p.file : `${p.file}:${p.line}`;
    lines.push(`- \`${where}\` — ${p.message}`);
  }
  lines.push("");
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
