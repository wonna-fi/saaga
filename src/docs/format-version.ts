import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * The corpus format this build of Saaga produces and consumes: the directory
 * layout, the document templates verification compares against, and the
 * frontmatter schema. Bump it whenever a change would make an older corpus
 * structurally fail against the new templates.
 */
export const CURRENT_FORMAT_VERSION = 1;

/**
 * Name of the version stamp inside the docs directory. It lives with the
 * corpus (not in `.saaga/config.yaml`) so that a corpus copied, cloned, or
 * checked out anywhere carries its own format identity.
 */
export const FORMAT_FILE = "FORMAT";

export type FormatVersionState =
  /** Docs directory absent or empty: greenfield, not a version-0 corpus. */
  | { state: "no-corpus" }
  /** A corpus exists; `version` is 0 when it predates the stamp. */
  | { state: "corpus"; version: number };

/**
 * Determines whether `docsPath` holds a corpus and, if so, which format
 * version it follows.
 *
 * The distinction between "no corpus" and "version 0" is load-bearing: an
 * absent or empty docs directory is a greenfield `init` target, while a
 * populated directory without a `FORMAT` file is a pre-beta corpus that every
 * update-family flow must refuse.
 */
export async function readFormatVersion(
  docsPath: string,
): Promise<FormatVersionState> {
  let entries: string[];
  try {
    entries = await readdir(docsPath);
  } catch {
    return { state: "no-corpus" };
  }

  if (entries.length === 0) {
    return { state: "no-corpus" };
  }

  let content: string;
  try {
    content = await readFile(resolve(docsPath, FORMAT_FILE), "utf8");
  } catch {
    return { state: "corpus", version: 0 };
  }

  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `invalid YAML in ${FORMAT_FILE} at ${docsPath}: ${message}`,
      { cause: err },
    );
  }

  const version =
    raw && typeof raw === "object"
      ? (raw as { format_version?: unknown }).format_version
      : undefined;

  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new Error(
      `missing or non-integer 'format_version' in ${FORMAT_FILE} at ${docsPath}`,
    );
  }

  return { state: "corpus", version };
}

/** Stamps `docsPath` with the current format version, creating it if needed. */
export async function writeFormatVersion(docsPath: string): Promise<void> {
  await mkdir(docsPath, { recursive: true });
  await writeFile(
    resolve(docsPath, FORMAT_FILE),
    `format_version: ${CURRENT_FORMAT_VERSION}\n`,
    "utf8",
  );
}
