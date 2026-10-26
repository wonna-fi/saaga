import { mkdir, readdir, rmdir } from "node:fs/promises";
import { resolve } from "node:path";
import { CATEGORY_ORDER } from "../docs/navigation.js";
import type { ScriptContext } from "./registry.js";

export interface EnsureDocsDirsArgs {
  /** Absolute path to the application directory. */
  app_dir: string;
  /** Docs directory, relative to `app_dir` or absolute. */
  docs_dir: string;
  /** `"create"` before the agent steps, `"prune"` once they are done. */
  mode: string;
}

/**
 * Creates the docs directory and every category directory under it, or
 * removes the category directories that ended up empty.
 *
 * Runs twice in `init`. In `create` mode, before the first agent step: some
 * backends can neither create a missing parent from their file tool nor run
 * `mkdir` from their restricted shell, so a corpus whose directories do not
 * exist yet would never be written. In `prune` mode, before the baseline: a
 * category is created up front whether or not the plan uses it, and one that
 * nothing was written into — typically `conventions` — is removed rather than
 * left behind empty. A directory with any entry is never touched.
 */
export async function ensureDocsDirs(
  args: EnsureDocsDirsArgs,
  _ctx: ScriptContext,
): Promise<void> {
  const { app_dir: appDir, docs_dir: docsDir, mode } = args;

  if (!appDir) throw new Error("ensure-docs-dirs: 'app_dir' arg is required");
  if (!docsDir) throw new Error("ensure-docs-dirs: 'docs_dir' arg is required");
  if (mode !== "create" && mode !== "prune") {
    throw new Error(
      `ensure-docs-dirs: 'mode' must be "create" or "prune" (got ${mode ? `"${mode}"` : "no value"})`,
    );
  }

  const docsPath = resolve(appDir, docsDir);
  for (const category of CATEGORY_ORDER) {
    const dir = resolve(docsPath, category);
    if (mode === "create") {
      await mkdir(dir, { recursive: true });
      continue;
    }
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    if (entries.length === 0) await rmdir(dir);
  }
}
