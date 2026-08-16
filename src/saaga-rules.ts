import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const SAAGA_RULES_FILE = ".saagarules";
const MAX_SIZE_BYTES = 64 * 1024;

export class SaagaRulesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaagaRulesError";
  }
}

/**
 * Load and validate `.saagarules` from the project root.
 *
 * Returns `undefined` when the file is absent or contains only whitespace.
 * Throws `SaagaRulesError` on size overflow, invalid UTF-8, or other I/O
 * errors so that user instructions are never silently omitted.
 */
export async function loadSaagaRules(
  projectRoot: string,
): Promise<string | undefined> {
  const filePath = resolve(projectRoot, SAAGA_RULES_FILE);

  let buf: Buffer;
  try {
    buf = await readFile(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw new SaagaRulesError(
      `Failed to read ${SAAGA_RULES_FILE}: ${(err as Error).message}`,
    );
  }

  if (buf.length > MAX_SIZE_BYTES) {
    throw new SaagaRulesError(
      `${SAAGA_RULES_FILE} exceeds the 64 KiB size limit (${buf.length} bytes)`,
    );
  }

  if (!isValidUtf8(buf)) {
    throw new SaagaRulesError(
      `${SAAGA_RULES_FILE} contains invalid UTF-8`,
    );
  }

  const content = buf.toString("utf8").trim();
  if (content.length === 0) {
    return undefined;
  }

  return content;
}

/**
 * Append user rules to a rendered prompt with an explicit bounded-priority
 * wrapper. Returns the original prompt unchanged when `rules` is undefined.
 */
export function appendSaagaRules(
  prompt: string,
  rules: string | undefined,
): string {
  if (!rules) return prompt;

  return (
    prompt +
    "\n\n---\n\n" +
    "## Additional project-specific documentation instructions (.saagarules)\n\n" +
    "The project maintainer has provided the following instructions and context " +
    "for documentation. Apply them at HIGH PRIORITY when producing documentation " +
    "content. However, they do not override required output formats, file paths, " +
    "workflow control instructions, or safety and permission constraints specified " +
    "above.\n\n" +
    rules +
    "\n"
  );
}

function isValidUtf8(buf: Buffer): boolean {
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    decoder.decode(buf);
    return true;
  } catch {
    return false;
  }
}
