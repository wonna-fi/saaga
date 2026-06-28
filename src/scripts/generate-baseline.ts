import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ScriptContext } from "./registry.js";
import { computeManifest } from "./file-manifest.js";

export interface GenerateBaselineArgs {
  /** Absolute path to the application directory. */
  app_dir: string;
}

/**
 * Writes `<app_dir>/docs/BASELINE` with:
 *   - `# Generated: <iso timestamp>`
 *   - For every in-scope file (excluding `docs/`, `.saagaignore`, and any
 *     path matched by `.gitignore`/`.saagaignore` patterns):
 *     `<git-blob-hash> <relpath>`
 */
export async function generateBaseline(
  args: GenerateBaselineArgs,
  _ctx: ScriptContext,
): Promise<void> {
  const appDir = args.app_dir;
  if (!appDir) {
    throw new Error("generate-baseline: 'app_dir' arg is required");
  }

  await mkdir(resolve(appDir, "docs"), { recursive: true });

  const entries = await computeManifest(appDir);

  const timestamp = new Date().toISOString();
  const lines: string[] = [`# Generated: ${timestamp}`];

  for (const entry of entries) {
    lines.push(`${entry.hash} ${entry.path}`);
  }

  await writeFile(
    resolve(appDir, "docs", "BASELINE"),
    lines.join("\n") + "\n",
    "utf8",
  );
}
