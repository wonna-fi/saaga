import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ScriptContext } from "./registry.js";

export interface CollectQuickUpdatesArgs {
  /** Absolute path to `<app>/docs/metadata/quick_updates`. */
  metadata_dir: string;
  /** Run directory where the manifest is written. */
  output_dir: string;
}

export interface CollectQuickUpdatesResult {
  /** Number of unverified quick-update artifact folders found. */
  count: number;
  /** Absolute path to the manifest file listing the snapshotted folders. */
  manifest_path: string;
  /** Ordered list of run-IDs (folder names) captured in this snapshot. */
  ids: string[];
}

/**
 * Snapshots the set of quick-update metadata folders present at invocation
 * time. Writes a JSON manifest into the run directory so that
 * `remove-quick-updates` can later delete exactly this set (artifacts
 * created after the snapshot are preserved).
 */
export async function collectQuickUpdates(
  args: CollectQuickUpdatesArgs,
  _ctx: ScriptContext,
): Promise<CollectQuickUpdatesResult> {
  if (!args.metadata_dir) {
    throw new Error(
      "collect-quick-updates: 'metadata_dir' arg is required",
    );
  }
  if (!args.output_dir) {
    throw new Error("collect-quick-updates: 'output_dir' arg is required");
  }

  const ids: string[] = [];

  if (await isDir(args.metadata_dir)) {
    const entries = await readdir(args.metadata_dir);
    for (const entry of entries.sort()) {
      const full = resolve(args.metadata_dir, entry);
      if (await isDir(full)) {
        ids.push(entry);
      }
    }
  }

  await mkdir(args.output_dir, { recursive: true });
  const manifestPath = resolve(args.output_dir, "quick-updates-manifest.json");

  const manifest = {
    metadata_dir: args.metadata_dir,
    ids,
    captured_at: new Date().toISOString(),
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  return {
    count: ids.length,
    manifest_path: manifestPath,
    ids,
  };
}

async function isDir(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}
