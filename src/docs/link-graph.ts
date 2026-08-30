import { readdir } from "node:fs/promises";
import { posix } from "node:path";

/** A single inline Markdown link found in a document. */
export interface DocLink {
  /** POSIX path of the file containing the link, relative to the docs root. */
  from: string;
  /** Raw link target exactly as written, e.g. `./flow-dsl.md`. */
  target: string;
  /** 1-based line number, for the report. */
  line: number;
}

/** A fenced ```mermaid block. */
export interface MermaidFence {
  /** 1-based line number of the opening fence. */
  line: number;
  /** Fence contents, without the fence lines themselves. */
  body: string;
  /**
   * Whether a closing fence was found. `false` means the document ends inside
   * the block — the signature of output that was cut off mid-diagram.
   */
  closed: boolean;
}

/**
 * Directories under the docs root that are never part of the navigable
 * corpus. `metadata/` holds quick-update run artifacts
 * (`metadata/quick_updates/<run-id>/summary.md`); they are archived evidence,
 * not documents anyone navigates to, so scanning them would report every one
 * of them as an orphan.
 */
const SKIPPED_DIRS = new Set(["metadata"]);

/**
 * Recursively lists every Markdown document under `docsRoot`.
 *
 * Returns POSIX paths relative to `docsRoot`, sorted, so callers and reports
 * are deterministic. Dot-directories and `SKIPPED_DIRS` are pruned. Non-`.md`
 * corpus files (`BASELINE`, `FORMAT`) are not documents and never enter the
 * link graph.
 *
 * `computeManifest()` in `src/scripts/file-manifest.ts` cannot be reused here:
 * it hard-excludes the docs directory by design.
 */
export async function listDocFiles(docsRoot: string): Promise<string[]> {
  const out: string[] = [];
  await walk(docsRoot, "", out);
  out.sort();
  return out;
}

async function walk(
  root: string,
  relDir: string,
  out: string[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(posix.join(root, relDir) || root, {
      withFileTypes: true,
    });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const rel = relDir ? posix.join(relDir, entry.name) : entry.name;

    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      await walk(root, rel, out);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      out.push(rel);
    }
  }
}

/**
 * Matches an inline Markdown link or image: `[text](target)`, `![alt](target)`.
 *
 * Deliberately narrow. The corpus uses exactly two target shapes —
 * `./sibling.md` and `../category/doc.md` — with no parentheses, spaces, or
 * titles, so a target is "everything up to the closing paren that is not
 * whitespace". Reference-style links, autolinks, and raw HTML anchors do not
 * occur and are not recognised.
 */
const LINK_RE = /!?\[[^\]\n]*\]\(\s*([^)\s]+)(?:\s+"[^"\n]*")?\s*\)/g;

/** Matches an inline code span, so links quoted as code are not extracted. */
const CODE_SPAN_RE = /(`+)(?:[^`]|(?!\1)`)*\1/g;

/**
 * Extracts every inline Markdown link from `content`.
 *
 * Links inside fenced code blocks and inline code spans are ignored: those are
 * examples, not navigation. That also disposes of the one construct in the
 * corpus that resembles an image link — the TypeScript non-null assertion
 * `m![1]` in `patterns/testing-with-fake-agent.md` — though the link regex
 * would reject it anyway, since no `(` follows the `]`.
 *
 * Images are treated exactly like links: a broken image target is a broken
 * relative reference and there is no reason to report it differently.
 */
export function extractLinks(content: string, fromPath: string): DocLink[] {
  const links: DocLink[] = [];
  const lines = content.split(/\r?\n/);
  const fence = new FenceScanner();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence.consume(line) !== "text") continue;

    const stripped = line.replace(CODE_SPAN_RE, "");
    LINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LINK_RE.exec(stripped)) !== null) {
      links.push({ from: fromPath, target: m[1], line: i + 1 });
    }
  }

  return links;
}

/**
 * Extracts every fenced ```mermaid block from `content`.
 *
 * A block left open at the end of the document is still returned, with
 * `closed: false`. Dropping it would silently excuse the exact failure this
 * whole check exists for: a diagram the writer never finished.
 */
export function extractMermaidFences(content: string): MermaidFence[] {
  const fences: MermaidFence[] = [];
  const lines = content.split(/\r?\n/);
  const fence = new FenceScanner();

  let open: { line: number; body: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const kind = fence.consume(lines[i]);
    if (kind === "open") {
      open = fence.info === "mermaid" ? { line: i + 1, body: [] } : null;
    } else if (kind === "close") {
      if (open) {
        fences.push({ line: open.line, body: open.body.join("\n"), closed: true });
      }
      open = null;
    } else if (kind === "fenced" && open) {
      open.body.push(lines[i]);
    }
  }

  if (open) {
    fences.push({ line: open.line, body: open.body.join("\n"), closed: false });
  }

  return fences;
}

type LineKind = "text" | "open" | "close" | "fenced";

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})\s*(\S*)/;

/**
 * Tracks whether a line sits inside a fenced code block.
 *
 * Classifies each line as it is fed in: `open` and `close` are the fence lines
 * themselves, `fenced` is content between them, `text` is ordinary prose. A
 * fence closes only on the same character repeated at least as many times as
 * the opener, with no info string — matching CommonMark closely enough that a
 * nested ```` ``` ```` inside a ```` ```` ```` block does not end it early.
 */
class FenceScanner {
  /** Info string of the currently open fence, lowercased. */
  info = "";

  private marker: string | null = null;

  consume(line: string): LineKind {
    const m = FENCE_RE.exec(line);

    if (this.marker === null) {
      if (!m) return "text";
      this.marker = m[1];
      this.info = m[2].toLowerCase();
      return "open";
    }

    if (
      m &&
      m[2] === "" &&
      m[1][0] === this.marker[0] &&
      m[1].length >= this.marker.length
    ) {
      this.marker = null;
      this.info = "";
      return "close";
    }

    return "fenced";
  }
}
