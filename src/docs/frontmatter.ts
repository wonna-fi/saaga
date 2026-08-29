import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/** The document kinds the corpus recognises. */
export const DOC_TYPES = [
  "concept",
  "pattern",
  "feature",
  "architecture",
  "index",
] as const;

export type DocType = (typeof DOC_TYPES)[number];

function isDocType(value: unknown): value is DocType {
  return (
    typeof value === "string" && (DOC_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Machine-readable metadata carried at the top of every generated document.
 *
 * Field names are aligned with OKF v0.1 where they overlap, so external
 * tooling can consume the corpus without a translation layer. Do not rename
 * fields without checking that alignment.
 */
export interface DocFrontmatter {
  /** Human-readable document title. */
  title: string;
  /** Which kind of document this is. */
  type: DocType;
  /** ISO date (`YYYY-MM-DD`) of the last verification pass that PASSed. */
  last_verified?: string;
  /** Source paths/globs whose behaviour this document's claims cover. */
  sources?: string[];
}

/** A single validation problem. Collected, never thrown. */
export interface FrontmatterError {
  /** The offending field, absent when the whole block is unparseable. */
  field?: string;
  message: string;
}

export interface ParsedDoc {
  /** `null` when the document carries no frontmatter block at all. */
  frontmatter: DocFrontmatter | null;
  /** Document content with the frontmatter block removed. */
  body: string;
  errors: FrontmatterError[];
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Splits a document into frontmatter and body.
 *
 * A document without a leading `---` block is not an error: pre-beta corpora
 * have no frontmatter and must keep flowing through every command unchanged.
 * Such a document returns `frontmatter: null` with the content untouched.
 *
 * Malformed YAML and invalid field values are reported through `errors` rather
 * than thrown, so a single bad document cannot abort a whole-corpus pass.
 */
export function parseDoc(content: string): ParsedDoc {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) {
    return { frontmatter: null, body: content, errors: [] };
  }

  const body = content.slice(match[0].length);

  let raw: unknown;
  try {
    raw = parseYaml(match[1]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      frontmatter: null,
      body,
      errors: [{ message: `invalid YAML in frontmatter: ${message}` }],
    };
  }

  if (raw === null || raw === undefined) {
    return {
      frontmatter: null,
      body,
      errors: [{ message: "frontmatter block is empty" }],
    };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      frontmatter: null,
      body,
      errors: [{ message: "frontmatter must be a YAML mapping" }],
    };
  }

  const { frontmatter, errors } = validate(raw as Record<string, unknown>);
  return { frontmatter, body, errors };
}

/**
 * Renders frontmatter + body back into a document.
 *
 * Fields are emitted in schema order so that a parse/serialize round trip is
 * stable and diffs stay readable.
 */
export function serializeDoc(
  frontmatter: DocFrontmatter,
  body: string,
): string {
  const ordered: Record<string, unknown> = {
    title: frontmatter.title,
    type: frontmatter.type,
  };
  if (frontmatter.last_verified !== undefined) {
    ordered.last_verified = frontmatter.last_verified;
  }
  if (frontmatter.sources !== undefined) {
    ordered.sources = frontmatter.sources;
  }

  const yaml = stringifyYaml(ordered);
  return `---\n${yaml}---\n${body}`;
}

/**
 * Validates a parsed mapping against the schema.
 *
 * Returns the frontmatter when every required field is usable; a document with
 * an unusable `title` or `type` yields `null` because callers cannot do
 * anything meaningful with a partially-typed document. Optional fields that
 * fail validation are dropped and reported.
 */
function validate(obj: Record<string, unknown>): {
  frontmatter: DocFrontmatter | null;
  errors: FrontmatterError[];
} {
  const errors: FrontmatterError[] = [];

  const title = obj.title;
  const titleOk = typeof title === "string" && title.trim().length > 0;
  if (!titleOk) {
    errors.push({
      field: "title",
      message:
        title === undefined
          ? "missing required field 'title'"
          : "'title' must be a non-empty string",
    });
  }

  const type = obj.type;
  const typeOk = isDocType(type);
  if (!typeOk) {
    errors.push({
      field: "type",
      message:
        type === undefined
          ? "missing required field 'type'"
          : `'type' must be one of: ${DOC_TYPES.join(", ")}`,
    });
  }

  let lastVerified: string | undefined;
  if (obj.last_verified !== undefined) {
    if (typeof obj.last_verified === "string" && ISO_DATE_RE.test(obj.last_verified)) {
      lastVerified = obj.last_verified;
    } else {
      errors.push({
        field: "last_verified",
        message: "'last_verified' must be an ISO date (YYYY-MM-DD)",
      });
    }
  }

  let sources: string[] | undefined;
  if (obj.sources !== undefined) {
    if (
      Array.isArray(obj.sources) &&
      obj.sources.every((s) => typeof s === "string")
    ) {
      sources = obj.sources;
    } else {
      errors.push({
        field: "sources",
        message: "'sources' must be a list of strings",
      });
    }
  }

  if (!titleOk || !typeOk) {
    return { frontmatter: null, errors };
  }

  const frontmatter: DocFrontmatter = { title, type };
  if (lastVerified !== undefined) frontmatter.last_verified = lastVerified;
  if (sources !== undefined) frontmatter.sources = sources;

  return { frontmatter, errors };
}
