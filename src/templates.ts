import { readFile } from "node:fs/promises";

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

  constructor(path: string) {
    super(`Prompt template not found: ${path}`);
    this.name = "TemplateFileNotFoundError";
    this.path = path;
  }
}

const PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export interface RenderPromptOptions {
  /**
   * When true, throws `MissingTemplateVariableError` for any placeholder
   * with no corresponding variable. Defaults to false to match the bash
   * port (`entrypoint.sh::render_prompt`), which leaves unmatched
   * placeholders intact so prompt templates can use `{Type}` etc. as
   * literal documentation.
   */
  strict?: boolean;
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
  return renderPrompt(content, vars, options);
}
