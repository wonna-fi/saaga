import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ScriptContext } from "./registry.js";

export interface EnsureGitignoreArgs {
  /** Absolute path to the application directory. */
  app_dir: string;
  /** Pattern to ensure is present (e.g. `.saaga-runs/`). */
  pattern: string;
}

/**
 * Ensures the given pattern is present in the project's `.gitignore`.
 * Creates the file if it does not exist.
 */
export async function ensureGitignore(
  args: EnsureGitignoreArgs,
  _ctx: ScriptContext,
): Promise<void> {
  const appDir = args.app_dir;
  if (!appDir) {
    throw new Error("ensure-gitignore: 'app_dir' arg is required");
  }
  const pattern = args.pattern;
  if (!pattern) {
    throw new Error("ensure-gitignore: 'pattern' arg is required");
  }

  const giPath = resolve(appDir, ".gitignore");
  let content: string;
  try {
    content = await readFile(giPath, "utf8");
  } catch {
    await writeFile(giPath, pattern + "\n", "utf8");
    return;
  }

  const lines = content.split("\n");
  if (lines.some((line) => line.trim() === pattern)) return;

  const suffix = content.endsWith("\n") ? "" : "\n";
  await writeFile(giPath, content + suffix + pattern + "\n", "utf8");
}
