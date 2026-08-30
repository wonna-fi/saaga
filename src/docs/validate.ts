import { posix } from "node:path";
import {
  extractLinks,
  extractMermaidFences,
  resolveLinkTarget,
} from "./link-graph.js";

/** A single structural defect found in the corpus. */
export interface DocProblem {
  kind: "broken-link" | "invalid-mermaid" | "orphan";
  /** POSIX path relative to the docs root. */
  file: string;
  /** 1-based line number; absent for whole-document problems (orphans). */
  line?: number;
  message: string;
}

export interface ValidationReport {
  brokenLinks: DocProblem[];
  invalidMermaid: DocProblem[];
  orphans: DocProblem[];
  filesChecked: number;
}

/** One document, as fed to `validateCorpus`. */
export interface DocInput {
  /** POSIX path relative to the docs root. */
  path: string;
  content: string;
}

export interface ValidateCorpusOptions {
  /**
   * Existence probe for a resolved link target, expressed as a POSIX path
   * relative to the docs root. A target may resolve *outside* the corpus (a
   * link to real source code such as `../src/cli.ts` normalises to a path
   * starting with `..`), which is legitimate — hence a probe rather than a
   * lookup in the document set.
   */
  exists: (relPath: string) => Promise<boolean>;
}

/**
 * Mermaid diagram keywords this validator recognises.
 *
 * Saaga does not depend on Mermaid itself: the real `mermaid` package needs a
 * DOM and `@mermaid-js/parser` pulls in Langium without even covering
 * `flowchart`. Both are disproportionate for a five-dependency package, so the
 * check is a shallow parse that catches breakage rather than style. Extend this
 * list when a new diagram type legitimately appears in a corpus.
 */
export const MERMAID_DIAGRAM_TYPES = [
  "flowchart",
  "graph",
  "sequenceDiagram",
  "classDiagram",
  "stateDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "journey",
  "gantt",
  "pie",
  "mindmap",
  "timeline",
  "gitGraph",
  "quadrantChart",
  "requirementDiagram",
  "C4Context",
] as const;

const FLOWCHART_DIRECTIONS = ["TD", "TB", "BT", "LR", "RL"];

/**
 * Documents that are entry points by definition and are therefore never
 * reported as orphans, however few inbound links they have.
 *
 * Every `INDEX.md` qualifies (within the corpus the three category indexes have
 * no inbound links at all — they are reached from `AGENTS.md` and
 * `DEVELOPING.md` outside it), as does a `README.md` at the docs root.
 * `ARCHITECTURE.md` deliberately does not. `generate-navigation` de-orphans it
 * by linking it from the generated README, and this check is what proves that
 * happened — exempting it would make the guarantee unfalsifiable, and a corpus
 * built before the navigation layer would go on hiding a real orphan.
 */
function isEntryPoint(path: string): boolean {
  return posix.basename(path) === "INDEX.md" || path === "README.md";
}

/**
 * Runs every structural check over an in-memory view of the corpus.
 *
 * Collects problems rather than throwing: a caller wants the whole picture in
 * one report, not the first defect. Deciding which problems are fatal is the
 * caller's job — see `src/scripts/validate-docs.ts`.
 */
export async function validateCorpus(
  docs: DocInput[],
  opts: ValidateCorpusOptions,
): Promise<ValidationReport> {
  const brokenLinks: DocProblem[] = [];
  const invalidMermaid: DocProblem[] = [];
  const known = new Set(docs.map((d) => d.path));
  const inbound = new Set<string>();

  for (const doc of docs) {
    for (const link of extractLinks(doc.content, doc.path)) {
      const resolved = resolveLinkTarget(link);
      if (resolved === null) continue;

      if (!(await opts.exists(resolved))) {
        brokenLinks.push({
          kind: "broken-link",
          file: doc.path,
          line: link.line,
          message: `unresolved link target \`${link.target}\``,
        });
        continue;
      }

      // A document does not de-orphan itself by linking to itself.
      if (known.has(resolved) && resolved !== doc.path) inbound.add(resolved);
    }

    for (const fence of extractMermaidFences(doc.content)) {
      const reason = fence.closed
        ? validateMermaidFence(fence.body)
        : "unterminated ```mermaid fence";
      if (reason !== null) {
        invalidMermaid.push({
          kind: "invalid-mermaid",
          file: doc.path,
          line: fence.line,
          message: reason,
        });
      }
    }
  }

  const orphans: DocProblem[] = docs
    .filter((d) => !inbound.has(d.path) && !isEntryPoint(d.path))
    .map((d) => ({
      kind: "orphan" as const,
      file: d.path,
      message: "no inbound links from any other document",
    }));

  return {
    brokenLinks,
    invalidMermaid,
    orphans,
    filesChecked: docs.length,
  };
}

/**
 * Normalises a link target to a POSIX path relative to the docs root, or
 * `null` when the target is not a relative file reference and so cannot be
 * checked structurally.
 *
 * Any `#anchor` suffix is stripped and the anchor itself is *not* validated:
 * that needs heading-slug matching, which is a separate problem, and no
 * document in the corpus uses one today.
 */

/**
 * Checks one Mermaid fence, returning a human-readable reason when it is
 * invalid and `null` when it passes.
 *
 * See `MERMAID_DIAGRAM_TYPES` for why this is a hand-rolled shallow check.
 */
export function validateMermaidFence(body: string): string | null {
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("%%"));

  if (lines.length === 0) return "empty diagram";

  const header = lines[0];
  const keyword = header.split(/[\s;]+/)[0];
  if (!(MERMAID_DIAGRAM_TYPES as readonly string[]).includes(keyword)) {
    return `unknown diagram type \`${keyword}\``;
  }

  if (keyword === "flowchart" || keyword === "graph") {
    const direction = header.slice(keyword.length).replace(/;+$/, "").trim();
    if (direction !== "" && !FLOWCHART_DIRECTIONS.includes(direction)) {
      return `invalid ${keyword} direction \`${direction}\``;
    }
    return checkUnclosedBrackets(lines.join("\n"));
  }

  return null;
}

const OPENERS = "([{";
const CLOSERS = ")]}";

/**
 * Reports node brackets left open across a flowchart body — a diagram cut off
 * mid-node, e.g. `A[CLI --> B[Backend]`.
 *
 * Three deliberate restrictions keep this from failing a *valid* diagram, which
 * would be far worse than missing an invalid one: it aborts a documenting flow
 * after the corpus is already on disk.
 *
 *   1. Flowcharts only. Other diagram types use the same characters as grammar
 *      rather than as pairs — `erDiagram` writes cardinality as `||--o{`, whose
 *      brace never closes.
 *   2. Unmatched *closers* are ignored, only unclosed openers count. The
 *      asymmetric flowchart node `A>text]` legitimately closes a bracket it
 *      never opened.
 *   3. Characters inside double quotes are skipped, because a quoted label may
 *      legitimately contain a lone bracket.
 */
function checkUnclosedBrackets(body: string): string | null {
  let depth = 0;
  let quoted = false;

  for (const ch of body) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;

    if (OPENERS.includes(ch)) depth++;
    else if (CLOSERS.includes(ch) && depth > 0) depth--;
  }

  return depth > 0 ? "unclosed brackets" : null;
}
