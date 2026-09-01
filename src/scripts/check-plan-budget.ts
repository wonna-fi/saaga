import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { NonResumableError } from "../engine/errors.js";

import {
  type BudgetReport,
  checkPlanBudget,
  countNonZeroPhases,
  deriveCeilings,
  docCost,
  measureSource,
  parsePlannedDocs,
  UNBUDGETED_CHARGE,
} from "../docs/corpus-budget.js";
import type { ScriptContext } from "./registry.js";

export interface CheckPlanBudgetArgs {
  /** Application root. */
  app_dir: string;
  /** Documentation directory name, relative to `app_dir`. */
  docs_dir: string;
  /** Path to the generated plan. */
  plan: string;
  /** Where the human-readable report is written. */
  report_path: string;
  /** `report` returns a verdict for a loop to read; `enforce` throws. */
  mode: string;
}

export interface CheckPlanBudgetResult {
  status: BudgetReport["status"];
  reasons: string;
  docs: number;
  doc_ceiling: number;
  lines: number;
  line_ceiling: number;
  source_lines: number;
  report_path: string;
}

/**
 * Hold a generated plan to a corpus-level budget.
 *
 * Runs twice in `init`: in `report` mode inside the planning loop, where an
 * over-budget plan is a verdict the loop reads and retries on, and once after
 * the loop in `enforce` mode, where it is a failure. The loop primitive exits
 * silently at its cap, so without the second call an over-budget plan would
 * simply proceed.
 */
export async function checkPlanBudgetScript(
  args: CheckPlanBudgetArgs,
  ctx: ScriptContext,
): Promise<CheckPlanBudgetResult> {
  const { app_dir: appDir, docs_dir: docsDir, plan, report_path: reportPath } = args;
  const mode = args.mode;

  if (!appDir) throw new Error("check-plan-budget: 'app_dir' arg is required");
  if (!docsDir) throw new Error("check-plan-budget: 'docs_dir' arg is required");
  if (!plan) throw new Error("check-plan-budget: 'plan' arg is required");
  if (!reportPath) throw new Error("check-plan-budget: 'report_path' arg is required");
  if (mode !== "report" && mode !== "enforce") {
    throw new Error(
      `check-plan-budget: 'mode' must be "report" or "enforce" (got ${mode ? `"${mode}"` : "no value"})`,
    );
  }

  // A wiring fault, not a plan fault: retrying cannot fix it, so both modes throw.
  let planText: string;
  try {
    planText = await readFile(resolve(appDir, plan), "utf8");
  } catch {
    throw new Error(`check-plan-budget: cannot read the plan at ${plan}`);
  }

  const source = await measureSource(appDir, docsDir);
  const ceilings = deriveCeilings(source);
  const parse = parsePlannedDocs(planText, docsDir);
  const report = checkPlanBudget(parse, ceilings, source, countNonZeroPhases(planText));

  await writeReport(reportPath, report, parse.docs.map((d) => ({ path: d.path, cost: docCost(d), budget: d.budget })));

  // Passing because nothing was measured looks identical to passing on merit.
  // Say so, so a stack the extension allowlist does not cover is visible
  // rather than quietly ungoverned.
  if (report.reasons.includes("no-measurable-source")) {
    ctx.warn?.(
      "check-plan-budget: no source files were measured, so no corpus ceiling " +
        "applies to this plan. If this repository does have source, its language " +
        "is missing from SOURCE_EXTENSIONS in src/docs/corpus-budget.ts.",
    );
  }

  if (mode === "report") {
    for (const path of report.unbudgeted) {
      ctx.warn?.(
        `check-plan-budget: ${path} has no line budget; charged ${UNBUDGETED_CHARGE} lines`,
      );
    }
    return toResult(report, reportPath);
  }

  if (report.status === "UNPARSEABLE") {
    throw new NonResumableError(
      `check-plan-budget: the plan's per-document decisions could not be read` +
        `${report.reasons.includes("one-sided-roster") ? " (budget lines and ownership lines do not agree)" : " (no documents found, but the plan declares domain phases)"}. ` +
        `The corpus budget was therefore never checked. See the report at ${reportPath}. ` +
        `Resuming replays the same plan, so delete ${docsDir}/ and run 'saaga run init' again to re-plan.`,
    );
  }

  if (report.status === "OVER") {
    throw new NonResumableError(
      `check-plan-budget: the plan exceeds the corpus budget for this repository — ` +
        `${report.docs} documents against a ceiling of ${report.ceilings.docs}, and ` +
        `${report.lines} budgeted lines against a ceiling of ${report.ceilings.lines} ` +
        `(derived from ${report.source.lines} source lines in ${report.source.files} files). ` +
        `See the report at ${reportPath}. ` +
        `Resuming replays the same plan, so delete ${docsDir}/ and run 'saaga run init' again to re-plan.`,
    );
  }

  return toResult(report, reportPath);
}

function toResult(report: BudgetReport, reportPath: string): CheckPlanBudgetResult {
  return {
    status: report.status,
    reasons: report.reasons.join(","),
    docs: report.docs,
    doc_ceiling: report.ceilings.docs,
    lines: report.lines,
    line_ceiling: report.ceilings.lines,
    source_lines: report.source.lines,
    report_path: reportPath,
  };
}

/**
 * The report is the retry's input, so it is written in both modes and before
 * any throw: a planner asked to try again has to be able to read why.
 */
async function writeReport(
  reportPath: string,
  report: BudgetReport,
  docs: { path: string; cost: number; budget: number | null }[],
): Promise<void> {
  const lines: string[] = [
    "# Corpus budget report",
    "",
    `Status: **${report.status}**`,
    "",
    "| Measure | Planned | Ceiling |",
    "| --- | --- | --- |",
    `| Documents | ${report.docs} | ${report.ceilings.docs} |`,
    `| Budgeted lines | ${report.lines} | ${report.ceilings.lines} |`,
    "",
    `Ceilings are derived from ${report.source.lines} source lines across ` +
      `${report.source.files} files. They are computed from the repository, not read ` +
      `from the plan.`,
    "",
  ];

  if (report.status === "OVER") {
    const overDocs = report.docs - report.ceilings.docs;
    const overLines = report.lines - report.ceilings.lines;
    lines.push(
      "## What to change",
      "",
      "Cut document **count** first, not the per-document budgets: fold peripheral " +
        "documents into the parent document they belong to, as a row or a section. " +
        "Trimming budgets to fit leaves the same number of files to read.",
      "",
    );
    if (overDocs > 0) lines.push(`- ${overDocs} document(s) over the ceiling.`);
    if (overLines > 0) lines.push(`- ${overLines} budgeted line(s) over the ceiling.`);
    lines.push("");
  }

  // An unreadable plan is not an over-budget one, and telling its author to
  // cut documents would steer them away from the actual defect.
  if (report.status === "UNPARSEABLE") {
    lines.push(
      "## What to change",
      "",
      report.reasons.includes("one-sided-roster")
        ? "The plan's budget lines and ownership lines do not agree: every document " +
          "needs both. The corpus budget could not be checked."
        : "No planned documents could be read from this plan, but it declares domain " +
          "phases. The corpus budget could not be checked.",
      "",
      "This is a **format** problem, not a size problem. Do not cut documents in " +
        "response to it — write the two decision lines per document exactly as the " +
        "plan format specifies:",
      "",
      "```",
      "<path> — <Core|Supporting|Peripheral>, <N> lines",
      "<path> — owns: <fact classes>; references: <paths>",
      "```",
      "",
      "Convention documents are the exception: they are listed as a bare path under " +
        "the conventions phase and get neither line.",
      "",
    );
  }

  if (report.unbudgeted.length > 0) {
    lines.push(
      "## Documents with no line budget",
      "",
      `Each is charged ${UNBUDGETED_CHARGE} lines — the Core band's ceiling — because an ` +
        "unbudgeted document cannot be assumed small. Assigning it a real budget is the fix.",
      "",
      ...report.unbudgeted.map((p) => `- ${p}`),
      "",
    );
  }

  if (report.missingOwnership.length > 0) {
    lines.push(
      "## Documents with no ownership declaration",
      "",
      "Not a budget problem, and it does not fail this check — but verification " +
        "skips the checks a document declares nothing for, so each of these enters " +
        "the corpus unconstrained. Give every document its " +
        "`<path> — owns: …; references: …` line.",
      "",
      ...report.missingOwnership.map((p) => `- ${p}`),
      "",
    );
  }

  if (report.belowTier.length > 0) {
    lines.push(
      "## Budgets below their declared tier",
      "",
      "Each is charged its tier's floor instead — Core 100, Supporting 60, " +
        "Peripheral 25. Tier comes from centrality, so a number below the band " +
        "describes a different tier, not a smaller document.",
      "",
      ...report.belowTier.map((p) => `- ${p}`),
      "",
    );
  }

  if (report.ambiguous.length > 0) {
    lines.push(
      "## Ambiguous paths",
      "",
      "These were written as a bare filename matching more than one planned document, " +
        "so they could not be matched to one. Write the full path.",
      "",
      ...report.ambiguous.map((p) => `- ${p}`),
      "",
    );
  }

  lines.push(
    "## Planned documents",
    "",
    "| Document | Budget | Charged |",
    "| --- | --- | --- |",
    ...docs.map((d) => `| ${d.path} | ${d.budget ?? "—"} | ${d.cost} |`),
    "",
  );

  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, lines.join("\n"), "utf8");
}
