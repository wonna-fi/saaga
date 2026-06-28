import { readFile } from "node:fs/promises";
import { interpolate } from "../expression.js";
import type { ReadFileStep, Scope } from "../types.js";

/**
 * Reads the file at `path` (after `${...}` interpolation) and binds the
 * UTF-8 contents to the variable named in `set`. Optionally trims
 * surrounding whitespace via `trim:true` (matches `tr -d '[:space:]'`
 * usage in `entrypoint.sh::mode_slice`).
 */
export async function runReadFileStep(
  step: ReadFileStep,
  scope: Scope,
): Promise<void> {
  const path = interpolate(step.path, scope);
  let content = await readFile(path, "utf8");
  if (step.trim) {
    content = content.trim();
  }
  scope[step.set] = content;
}
