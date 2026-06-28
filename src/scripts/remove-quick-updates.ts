import { readFile, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { ScriptContext } from "./registry.js";

export interface RemoveQuickUpdatesArgs {
  /** Absolute path to the manifest JSON written by collect-quick-updates. */
  manifest: string;
}

interface Manifest {
  metadata_dir: string;
  ids: string[];
}

/**
 * Deletes exactly the quick-update metadata folders listed in the manifest
 * produced by `collect-quick-updates`. Folders created after the snapshot
 * are left untouched.
 */
export async function removeQuickUpdates(
  args: RemoveQuickUpdatesArgs,
  _ctx: ScriptContext,
): Promise<void> {
  if (!args.manifest) {
    throw new Error("remove-quick-updates: 'manifest' arg is required");
  }
  const raw = await readFile(args.manifest, "utf8");
  const manifest = JSON.parse(raw) as Manifest;

  if (
    !manifest.metadata_dir ||
    !Array.isArray(manifest.ids)
  ) {
    throw new Error(
      `remove-quick-updates: invalid manifest at ${args.manifest}`,
    );
  }

  const baseDir = resolve(manifest.metadata_dir);
  for (const id of manifest.ids) {
    const folder = resolve(baseDir, id);
    // Defense-in-depth: never delete anything outside the metadata dir, even
    // if a manifest id contains `..` or an absolute path.
    const rel = relative(baseDir, folder);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(
        `remove-quick-updates: refusing to delete '${id}' outside metadata_dir`,
      );
    }
    await rm(folder, { recursive: true, force: true });
  }
}
