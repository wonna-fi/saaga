import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  ARCHITECTURE_DOC,
  countNonZeroPhases,
  isCategoryDoc,
  parsePlannedDocs,
} from "../docs/corpus-budget.js";
import { CATEGORY_ORDER } from "../docs/navigation.js";
import type { ScriptContext } from "./registry.js";

export interface CheckPlannedDocsArgs {
  /** Application root. */
  app_dir: string;
  /** Documentation directory name, relative to `app_dir`. */
  docs_dir: string;
  /** Path to the generated plan. */
  plan: string;
}

export interface CheckPlannedDocsResult {
  /**
   * Documents the plan names, plus ARCHITECTURE.md and the INDEX.md of each
   * category they are filed under.
   */
  expected: number;
  /** Of those, how many are not on disk. Always 0 when the script returns. */
  missing: number;
}

/** How many missing paths the error message spells out before summarising. */
const MAX_LISTED = 20;

/**
 * Refuse to baseline a corpus whose planned documents were never written.
 *
 * Every writer in `init` is an agent step, and an agent that could not create
 * the docs directory still exits 0. The verify loops notice — each round ends
 * in a FAIL — but `loop` exits silently at its cap, and `validate-docs` passes
 * over an empty corpus. Without this step the run completes, writes a BASELINE
 * that marks the source as documented, and `update` then finds nothing to do.
 * It runs immediately before `generate-baseline` for that reason.
 */
export async function checkPlannedDocs(
  args: CheckPlannedDocsArgs,
  _ctx: ScriptContext,
): Promise<CheckPlannedDocsResult> {
  const { app_dir: appDir, docs_dir: docsDir, plan } = args;

  if (!appDir) throw new Error("check-planned-docs: 'app_dir' arg is required");
  if (!docsDir) throw new Error("check-planned-docs: 'docs_dir' arg is required");
  if (!plan) throw new Error("check-planned-docs: 'plan' arg is required");

  // A wiring fault, not a corpus fault: the plan is the one artifact every
  // earlier step read, so its absence here means the flow is miswired.
  let planText: string;
  try {
    planText = await readFile(resolve(appDir, plan), "utf8");
  } catch {
    throw new Error(`check-planned-docs: cannot read the plan at ${plan}`);
  }

  // The budget gate's roster, narrowed to documents filed under a category
  // folder, where every writer template puts them. The roster charges a bare
  // basename, a docs-dir path outside the categories, or any path a budget or
  // ownership line names, because each costs budget. Requiring them here would
  // demand files no writer template puts there, or one file for a basename two
  // categories share, and fail a complete corpus.
  const paths = parsePlannedDocs(planText, docsDir)
    .docs.map((d) => d.path)
    .filter(isCategoryDoc);

  // The budget gate's empty-roster guard is skipped when the repository has no
  // source it can measure, so an unreadable plan can reach this step. Passing
  // it would check ARCHITECTURE.md alone.
  if (paths.length === 0 && countNonZeroPhases(planText) > 0) {
    throw new Error(
      `check-planned-docs: the plan at ${plan} declares domain phases but names no ` +
        `documents under ${CATEGORY_ORDER.map((c) => `${docsDir}/${c}/`).join(", ")}, ` +
        `so the corpus cannot be checked against it`,
    );
  }

  // Phase 0 writes each category's INDEX.md and every slice writer adds its
  // rows there; no step generates one. Navigation is built from those rows, so
  // a missing index leaves its documents out of README.md and GLOSSARY.md, and
  // with none at all navigation is skipped with only a warning. A category the
  // plan files nothing under owes no index.
  const indexes = CATEGORY_ORDER.filter((c) =>
    paths.some((p) => p.startsWith(`${c}/`)),
  ).map((c) => `${c}/INDEX.md`);

  // Written before the plan exists, so it is expected on disk whether or not
  // the plan records its decisions.
  paths.unshift(ARCHITECTURE_DOC, ...indexes);

  const missing: string[] = [];
  for (const path of paths) {
    if (!(await isFile(resolve(appDir, docsDir, path)))) missing.push(path);
  }

  if (missing.length > 0) {
    const listed = missing.slice(0, MAX_LISTED).map((p) => `${docsDir}/${p}`);
    const rest = missing.length - listed.length;
    // A plain Error, so the resume hint prints: this step reads the plan and
    // the disk afresh on every attempt, and resuming skips the agent steps
    // that already ran, so a corpus completed by hand is not thrown away.
    throw new Error(
      `check-planned-docs: ${missing.length} of ${paths.length} documents the plan ` +
        `names were never written to ${docsDir}/: ${listed.join(", ")}` +
        `${rest > 0 ? ` and ${rest} more` : ""}. ` +
        `The agent steps that should have written them reported success, so the ` +
        `corpus is incomplete and no baseline was written. Resuming does not run ` +
        `those steps again: write the missing documents, or remove them from the ` +
        `plan at ${plan}, and then resume. To start over instead, delete ${docsDir}/ ` +
        `and run 'saaga run init' again.`,
    );
  }

  return { expected: paths.length, missing: 0 };
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
