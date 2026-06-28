import { access, copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { ScriptContext } from "./registry.js";

export interface ArchiveQuickUpdateArgs {
  /** Absolute path to the changes report produced by detect-changes. */
  changes_path: string;
  /** Absolute path to the metadata folder for this quick-update run. */
  dest_dir: string;
  /**
   * Absolute path to the summary the quick-update agent must have written for
   * an `UPDATED` run. When provided, the summary must already exist on disk;
   * otherwise we refuse to archive so the caller does not advance the baseline
   * with an incomplete artifact that `verify-quick-updates` cannot consume.
   */
  summary_path?: string;
}

/**
 * Copies the detect-changes report into the quick-update metadata folder
 * so that `verify-quick-updates` can later reconstruct the full change
 * context without re-running detect-changes (the baseline will have
 * advanced by then).
 */
export async function archiveQuickUpdate(
  args: ArchiveQuickUpdateArgs,
  _ctx: ScriptContext,
): Promise<void> {
  if (!args.changes_path) {
    throw new Error("archive-quick-update: 'changes_path' arg is required");
  }
  if (!args.dest_dir) {
    throw new Error("archive-quick-update: 'dest_dir' arg is required");
  }
  if (args.summary_path) {
    try {
      await access(args.summary_path);
    } catch {
      throw new Error(
        `archive-quick-update: expected summary at '${args.summary_path}' ` +
          "but it does not exist; refusing to archive an incomplete UPDATED artifact",
      );
    }
  }
  await mkdir(args.dest_dir, { recursive: true });
  await copyFile(args.changes_path, resolve(args.dest_dir, "changes.md"));
}
