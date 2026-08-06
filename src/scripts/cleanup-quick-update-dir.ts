import { rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { ScriptContext } from "./registry.js";

export interface CleanupQuickUpdateDirArgs {
  /** Absolute path to the `metadata/quick_updates` root. */
  metadata_root: string;
  /** Run identifier whose pre-created folder should be removed. */
  run_id: string;
}

/**
 * Removes a single pre-created quick-update metadata folder when the agent
 * wrote SKIPPED rather than UPDATED.  Validates that the resolved folder is
 * strictly inside `metadata_root` to prevent path-traversal attacks.
 */
export async function cleanupQuickUpdateDir(
  args: CleanupQuickUpdateDirArgs,
  _ctx: ScriptContext,
): Promise<void> {
  if (!args.metadata_root) {
    throw new Error(
      "cleanup-quick-update-dir: 'metadata_root' arg is required",
    );
  }
  if (!args.run_id) {
    throw new Error(
      "cleanup-quick-update-dir: 'run_id' arg is required",
    );
  }

  const base = resolve(args.metadata_root);
  const folder = resolve(base, args.run_id);

  const rel = relative(base, folder);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `cleanup-quick-update-dir: refusing to delete '${args.run_id}' outside metadata_root`,
    );
  }

  await rm(folder, { recursive: true, force: true });
}
