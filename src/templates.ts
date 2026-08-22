import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";

export class MissingTemplateVariableError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`Missing template variable: {${key}}`);
    this.name = "MissingTemplateVariableError";
    this.key = key;
  }
}

export class TemplateFileNotFoundError extends Error {
  readonly path: string;

  constructor(path: string, rootsTried?: readonly string[]) {
    super(
      rootsTried && rootsTried.length > 0
        ? `Prompt template not found: ${path} (searched: ${rootsTried.join(", ")})`
        : `Prompt template not found: ${path}`,
    );
    this.name = "TemplateFileNotFoundError";
    this.path = path;
  }
}

/**
 * Thrown when an include directive references a path that escapes every
 * configured search root (an absolute path, or one that climbs out with `..`).
 *
 * Include specs come from template *content*, so this is the boundary that
 * keeps the directive from becoming an arbitrary-file-read primitive.
 */
export class IncludeOutsideRootError extends Error {
  readonly spec: string;

  constructor(spec: string) {
    super(`Include escapes the allowed roots: {include:${spec}}`);
    this.name = "IncludeOutsideRootError";
    this.spec = spec;
  }
}

export class CircularIncludeError extends Error {
  readonly chain: readonly string[];

  constructor(chain: readonly string[], reason: "cycle" | "depth") {
    super(
      reason === "cycle"
        ? `Circular include detected: ${chain.join(" -> ")}`
        : `Include nesting too deep (limit ${MAX_INCLUDE_DEPTH}): ${chain.join(" -> ")}`,
    );
    this.name = "CircularIncludeError";
    this.chain = [...chain];
  }
}

const PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

/**
 * Include directive: `{include:partials/concept-template.md}`.
 *
 * The colon and slashes make this unmatchable by `PLACEHOLDER_RE`, so the two
 * mechanisms cannot collide.
 */
const INCLUDE_RE = /\{include:([^{}\r\n]+)\}/g;

const MAX_INCLUDE_DEPTH = 10;

export interface RenderPromptOptions {
  /**
   * When true, throws `MissingTemplateVariableError` for any placeholder
   * with no corresponding variable. Defaults to false to match the bash
   * port (`entrypoint.sh::render_prompt`), which leaves unmatched
   * placeholders intact so prompt templates can use `{Type}` etc. as
   * literal documentation.
   */
  strict?: boolean;
  /**
   * Ordered search path for resolving `{include:...}` directives.
   *
   * Each include is resolved against the including file's own directory
   * first, then against these roots in order; the first existing file wins.
   * Defaults to `[dirname(path)]` in `renderPromptFile()`.
   *
   * This module deliberately does not import `PROMPTS_DIR` — callers supply
   * the roots, so rendering a prompt from somewhere else (a project's own
   * prompt directory, say) is a matter of passing a different list.
   */
  includeRoots?: readonly string[];
}

/**
 * Substitutes `{key}` placeholders in `template` using `vars`.
 *
 * Semantics (match the bash port `entrypoint.sh::render_prompt`):
 *   - Multiple occurrences of the same key are all replaced.
 *   - Extra keys in `vars` (not referenced in the template) are ignored.
 *   - Values are inserted literally (no regex backreference interpretation).
 *   - Placeholders with no matching variable are LEFT INTACT. This lets
 *     existing prompt files use `{Type}`, `{ServiceOrModule}`, etc. as
 *     literal documentation without escaping.
 *
 * Pass `strict: true` to opt in to fail-fast behavior (used in unit tests
 * for the renderer itself; not used by the engine for real prompts).
 *
 * This function does not resolve includes — it is synchronous, and includes
 * need the filesystem. `renderPromptFile()` resolves them first.
 */
export function renderPrompt(
  template: string,
  vars: Record<string, string>,
  options: RenderPromptOptions = {},
): string {
  return template.replace(PLACEHOLDER_RE, (match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) {
      if (options.strict) {
        throw new MissingTemplateVariableError(key);
      }
      return match;
    }
    return vars[key];
  });
}

async function readTemplate(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw err;
  }
}

/**
 * Resolves `spec` against `selfDir` followed by `roots`, returning the first
 * existing file. Paths that escape the directory they were resolved against
 * are rejected rather than searched.
 */
async function resolveIncludePath(
  spec: string,
  selfDir: string,
  roots: readonly string[],
): Promise<{ path: string; content: string }> {
  if (isAbsolute(spec)) {
    throw new IncludeOutsideRootError(spec);
  }

  const searchPath = [...new Set([selfDir, ...roots])];
  const contained: string[] = [];

  for (const root of searchPath) {
    const candidate = resolve(root, spec);
    if (candidate !== root && !candidate.startsWith(root + sep)) {
      // Climbs out of this root; it may still be legitimate under another.
      continue;
    }
    contained.push(candidate);
    const content = await readTemplate(candidate);
    if (content !== undefined) {
      return { path: candidate, content };
    }
  }

  if (contained.length === 0) {
    throw new IncludeOutsideRootError(spec);
  }
  throw new TemplateFileNotFoundError(spec, searchPath);
}

async function expandIncludes(
  template: string,
  selfDir: string,
  roots: readonly string[],
  chain: readonly string[],
): Promise<string> {
  const matches = [...template.matchAll(INCLUDE_RE)];
  if (matches.length === 0) {
    return template;
  }

  if (chain.length > MAX_INCLUDE_DEPTH) {
    throw new CircularIncludeError(chain, "depth");
  }

  const replacements = await Promise.all(
    matches.map(async (match) => {
      const spec = match[1].trim();
      const { path, content } = await resolveIncludePath(spec, selfDir, roots);

      if (chain.includes(path)) {
        throw new CircularIncludeError([...chain, path], "cycle");
      }

      const expanded = await expandIncludes(content, dirname(path), roots, [
        ...chain,
        path,
      ]);
      // Drop one trailing newline so `{include:x}` on its own line does not
      // introduce a blank line that was not in the partial.
      return expanded.replace(/\r?\n$/, "");
    }),
  );

  let i = 0;
  return template.replace(INCLUDE_RE, () => replacements[i++]);
}

/**
 * Expands `{include:...}` directives in `template`.
 *
 * Includes are resolved before `{var}` substitution so that placeholders
 * inside a partial still resolve, and so that a variable *value* containing
 * `{include:` is never expanded.
 */
export async function resolveIncludes(
  template: string,
  opts: { selfDir: string; roots?: readonly string[] },
): Promise<string> {
  return expandIncludes(template, opts.selfDir, opts.roots ?? [], []);
}

export async function renderPromptFile(
  path: string,
  vars: Record<string, string>,
  options: RenderPromptOptions = {},
): Promise<string> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new TemplateFileNotFoundError(path);
    }
    throw err;
  }
  const selfDir = dirname(path);
  const expanded = await resolveIncludes(content, {
    selfDir,
    roots: options.includeRoots ?? [selfDir],
  });
  return renderPrompt(expanded, vars, options);
}
