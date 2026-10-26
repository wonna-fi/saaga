import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { ARCHITECTURE_DOC, parsePlannedDocs } from "../docs/corpus-budget.js";
import { NonResumableError } from "../engine/errors.js";
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
  /** Documents the plan names, ARCHITECTURE.md included. */
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

  // The same roster the budget gate holds the plan to, plus ARCHITECTURE.md:
  // it is written before the plan exists and is expected on disk whether or
  // not the plan records its decisions.
  const paths = parsePlannedDocs(planText, docsDir).docs.map((d) => d.path);
  if (!paths.includes(ARCHITECTURE_DOC)) paths.unshift(ARCHITECTURE_DOC);

  const missing: string[] = [];
  for (const path of paths) {
    if (!(await isFile(resolve(appDir, docsDir, path)))) missing.push(path);
  }

  if (missing.length > 0) {
    const listed = missing.slice(0, MAX_LISTED).map((p) => `${docsDir}/${p}`);
    const rest = missing.length - listed.length;
    throw new NonResumableError(
      `check-planned-docs: ${missing.length} of ${paths.length} documents the plan ` +
        `names were never written to ${docsDir}/: ${listed.join(", ")}` +
        `${rest > 0 ? ` and ${rest} more` : ""}. ` +
        `The agent steps that should have written them reported success, so the ` +
        `corpus is incomplete and no baseline was written. Resuming replays the same ` +
        `steps, so delete ${docsDir}/ and run 'saaga run init' again.`,
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
