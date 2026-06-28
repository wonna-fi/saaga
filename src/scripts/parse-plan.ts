import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { ScriptContext } from "./registry.js";

export interface Phase {
  number: number;
  title: string;
}

export interface ParsePlanArgs {
  /** Absolute path to the plan file with YAML frontmatter. */
  file: string;
  /**
   * When `"true"`, an empty `phases: []` array is rejected with an error.
   * Flows where an empty plan is a legitimate no-op (e.g. `update`, where
   * triage may find no doc-worthy changes) leave this unset. Flows where an
   * empty plan is anomalous and would cause data loss downstream (e.g.
   * `verify-quick-updates`, whose next step deletes collected metadata) set
   * it to fail fast instead of silently skipping verification.
   */
  require_phases?: string;
}

/**
 * TS port of `scripts/parse-plan.sh`. Reads the plan file, extracts the
 * YAML frontmatter, and returns the `phases` array as `[{number, title}]`.
 *
 * Uses the `yaml` library to do real YAML parsing instead of the regex
 * approach the bash script needed.
 */
export async function parsePlan(
  args: ParsePlanArgs,
  _ctx: ScriptContext,
): Promise<Phase[]> {
  if (!args.file) {
    throw new Error("parse-plan: 'file' arg is required");
  }
  const content = await readFile(args.file, "utf8");
  const frontmatter = extractFrontmatter(content);
  if (frontmatter === null) {
    throw new Error(
      `parse-plan: no YAML frontmatter found in ${args.file}`,
    );
  }
  const data = parseYaml(frontmatter);
  if (!data || typeof data !== "object" || !Array.isArray((data as { phases?: unknown }).phases)) {
    throw new Error(
      `parse-plan: missing or invalid 'phases' array in frontmatter of ${args.file}`,
    );
  }
  const rawPhases = (data as { phases: unknown[] }).phases;
  if (args.require_phases === "true" && rawPhases.length === 0) {
    throw new Error(
      `parse-plan: 'phases' array is empty in frontmatter of ${args.file}`,
    );
  }
  return rawPhases.map((p, i) => coercePhase(p, i, args.file));
}

function coercePhase(raw: unknown, index: number, file: string): Phase {
  if (!raw || typeof raw !== "object") {
    throw new Error(
      `parse-plan: phase[${index}] in ${file} must be an object`,
    );
  }
  const obj = raw as Record<string, unknown>;
  const numberCandidate = obj.number;
  const number =
    typeof numberCandidate === "number"
      ? numberCandidate
      : Number(numberCandidate);
  if (!Number.isFinite(number)) {
    throw new Error(
      `parse-plan: phase[${index}].number is not numeric in ${file}`,
    );
  }
  const title = obj.title;
  if (typeof title !== "string" || title.length === 0) {
    throw new Error(
      `parse-plan: phase[${index}].title is missing or empty in ${file}`,
    );
  }
  return { number, title };
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function extractFrontmatter(content: string): string | null {
  const match = FRONTMATTER_RE.exec(content);
  return match ? match[1] : null;
}
