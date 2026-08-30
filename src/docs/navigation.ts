import { posix } from "node:path";
import { extractLinks, FenceScanner } from "./link-graph.js";
import { parseDoc, serializeDoc } from "./frontmatter.js";

/** Docs-root-relative path of the generated reading-order page. */
export const README_FILE = "README.md";
/** Docs-root-relative path of the generated glossary. */
export const GLOSSARY_FILE = "GLOSSARY.md";

/**
 * The files this module writes.
 *
 * They are removed from the corpus view before anything is computed, so a
 * second run sees exactly what the first one saw. Without this the glossary —
 * which links every document — feeds its own link counts back into the next
 * run's core-concept ranking.
 */
export const GENERATED_FILES: readonly string[] = [README_FILE, GLOSSARY_FILE];

/** How many concepts the README's reading order names. */
export const CORE_CONCEPT_COUNT = 4;

/**
 * Category directories in reading order: what things are, then how to work on
 * them, then what the system does. Categories not listed here follow, sorted.
 */
export const CATEGORY_ORDER: readonly string[] = [
  "concepts",
  "patterns",
  "features",
];

/** One document, as fed to the navigation builder. */
export interface NavDoc {
  /** POSIX path relative to the docs root. */
  path: string;
  content: string;
}

/** A defect found while building the navigation layer. Collected, never thrown. */
export interface NavigationProblem {
  /** POSIX path relative to the docs root. */
  file: string;
  /** 1-based line in the original file, when the defect is a specific line. */
  line?: number;
  message: string;
}

/** One parsed row of a category `INDEX.md`. */
export interface IndexRow {
  /** POSIX path of the INDEX the row came from, e.g. `"concepts/INDEX.md"`. */
  index: string;
  /** Category directory, e.g. `"concepts"`. `""` for a docs-root INDEX. */
  category: string;
  /** Link text, verbatim. The document's display name and its glossary term. */
  name: string;
  /** Link target exactly as written, e.g. `"./flow-dsl.md"`. */
  target: string;
  /** `target` resolved to a POSIX path relative to the docs root. */
  path: string;
  /** Description cell, trimmed at both ends and otherwise verbatim. */
  description: string;
  /** 1-based line in the original INDEX file. */
  line: number;
}

export interface ParsedIndex {
  rows: IndexRow[];
  problems: NavigationProblem[];
}

/** One document a term is defined in. */
export interface TermHome {
  /** Display name — the document's INDEX row link text, verbatim. */
  name: string;
  /** POSIX path relative to the docs root. */
  path: string;
  /** Link target from the docs root, e.g. `"./concepts/flow-dsl.md"`. */
  href: string;
  /** The document's INDEX row description, verbatim. May be `""`. */
  description: string;
  /** Position in `collectIndexRows()`'s `rows`; the sole ordering key. */
  order: number;
}

/** One glossary term and every document that claims it. */
export interface GlossaryEntry {
  /** The term as displayed, taken verbatim from its lowest-`order` home. */
  term: string;
  /** `term.trim().toLowerCase()` — the grouping key and the sort key. */
  key: string;
  /** Deduplicated by `path`, sorted by `order`. Length > 1 renders "see also". */
  homes: TermHome[];
}

/** One bullet in a generated page. */
export interface NavLink {
  text: string;
  href: string;
  /** Verbatim INDEX description, or a fixed generator string. `""` omits it. */
  description: string;
}

export interface ReadmeModel {
  app: string;
  /** Absent when `ARCHITECTURE.md` is missing; the section is then omitted. */
  architecture?: NavLink;
  coreConcepts: NavLink[];
  features: NavLink[];
  /** One per category INDEX, in category order, plus the glossary. */
  indexes: NavLink[];
}

/** One rendered file. */
export interface NavigationFile {
  /** POSIX path relative to the docs root. */
  path: string;
  content: string;
}

export interface NavigationStats {
  indexes: number;
  rows: number;
  terms: number;
  /** Terms with more than one home. */
  collisions: number;
  core_concepts: number;
}

export interface NavigationResult {
  /** Empty when there is no INDEX to build from. */
  files: NavigationFile[];
  problems: NavigationProblem[];
  stats: NavigationStats;
}

export interface BuildNavigationInput {
  /** Application name; the README title is `"<app> Documentation"`. */
  app: string;
  /** Every Markdown document under the docs root, from `listDocFiles()`. */
  docs: NavDoc[];
}

/**
 * One row of a category index: `| [Display Name](./slug.md) | description |`.
 *
 * Anchored on the final pipe rather than split on pipes, so an escaped `\|`
 * inside a description survives verbatim. The format is exactly two columns;
 * anything after the second folds into the description, which is visible in
 * the glossary and therefore self-reporting.
 */
const INDEX_ROW_RE = /^\|\s*\[([^\]\n]+)\]\(\s*([^)\s]+)\s*\)\s*\|\s*(.*?)\s*\|$/;

/** A pipe-delimited line that carries a Markdown link but is not a row. */
const HAS_LINK_RE = /\]\(/;

/** Matches a level-one ATX heading, the fallback source of a display name. */
const H1_RE = /^#\s+(.+?)\s*$/;

// ---------------------------------------------------------------------------
// Authored strings. Everything else in a generated page is copied from an
// INDEX row or a document heading — these five are the only prose this module
// writes, and they are constants so they cannot drift between runs.
// ---------------------------------------------------------------------------

const README_INTRO =
  "Generated navigation for this corpus. Saaga rewrites this file from the\n" +
  "INDEX files on every documentation run — edit the documents it links to, not\n" +
  "this page.";
const READING_ORDER_WITH_ARCHITECTURE =
  "Read in order: the architecture, then the core concepts, then the workflows.";
const READING_ORDER_WITHOUT_ARCHITECTURE =
  "Read in order: the core concepts, then the workflows.";
const CORE_CONCEPTS_LEAD =
  "The concepts the rest of the corpus links to most often. Everything else assumes them.";
const FEATURES_LEAD = "What the system does, end to end, in index order.";
const GLOSSARY_LINK_DESCRIPTION =
  "every indexed term, with the definition its index gives it";
const GLOSSARY_INTRO =
  "Every term the INDEX files name, with the one-line definition its index gives\n" +
  "it. Saaga regenerates this file on every documentation run and copies each\n" +
  "definition verbatim — to change one, change the INDEX row it comes from.";

/**
 * Parses one category `INDEX.md`.
 *
 * Never throws; every defect lands in `problems`. `indexPath` is
 * docs-root-relative and is what row targets resolve against.
 *
 * The parser scans for lines that *look like* rows rather than requiring a
 * well-formed table, so a missing header or separator is not a defect. Rows
 * inside fenced code blocks are examples, not entries, and are skipped.
 */
export function parseIndex(indexPath: string, content: string): ParsedIndex {
  const rows: IndexRow[] = [];
  const problems: NavigationProblem[] = [];

  const { body } = parseDoc(content);
  // `parseDoc` strips the frontmatter, so body line numbers are not file line
  // numbers. Every reported line adds the difference back.
  const offset = lineCount(content) - lineCount(body);

  const dir = posix.dirname(indexPath);
  const category = dir === "." ? "" : dir;
  const seen = new Set<string>();
  const fence = new FenceScanner();

  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (fence.consume(lines[i]) !== "text") continue;

    const line = lines[i].trim();
    if (!line.startsWith("|")) continue;

    const m = INDEX_ROW_RE.exec(line);
    if (!m) {
      // The header and separator rows carry no link and are not defects; a
      // pipe line that does carry one was meant to be an entry.
      if (HAS_LINK_RE.test(line)) {
        problems.push({
          file: indexPath,
          line: offset + i + 1,
          message: "unparseable index row",
        });
      }
      continue;
    }

    const [, name, target, description] = m;
    const path = category ? posix.join(category, target) : posix.normalize(target);
    const row: IndexRow = {
      index: indexPath,
      category,
      name,
      target,
      path,
      description,
      line: offset + i + 1,
    };

    if (seen.has(path)) {
      problems.push({
        file: indexPath,
        line: row.line,
        message: `duplicate index row for \`${path}\``,
      });
      continue;
    }
    seen.add(path);

    if (description === "") {
      problems.push({
        file: indexPath,
        line: row.line,
        message: `index row for \`${path}\` has no description`,
      });
    }

    rows.push(row);
  }

  return { rows, problems };
}

/**
 * Parses every `INDEX.md` in `docs`, in category order, dropping rows whose
 * target is not a Markdown document inside the corpus.
 *
 * The returned `rows` array is the corpus's canonical *index order*: every
 * downstream tie is broken by a document's position in it.
 *
 * Dropping an unresolvable row is not tidiness. `validate-docs` runs straight
 * after the generator and *fails the flow* on a broken link, so copying a
 * stale row would turn a harmless documentation defect into an abort nobody
 * can trace back to the INDEX.
 */
export function collectIndexRows(docs: NavDoc[]): ParsedIndex {
  const known = new Set(docs.map((d) => d.path));
  const rows: IndexRow[] = [];
  const problems: NavigationProblem[] = [];

  for (const doc of indexDocs(docs)) {
    const parsed = parseIndex(doc.path, doc.content);
    problems.push(...parsed.problems);

    for (const row of parsed.rows) {
      if (!row.path.toLowerCase().endsWith(".md") || row.path.startsWith("..")) {
        problems.push({
          file: row.index,
          line: row.line,
          message: `index row target \`${row.target}\` is not a corpus document`,
        });
        continue;
      }
      if (!known.has(row.path)) {
        problems.push({
          file: row.index,
          line: row.line,
          message: `index row target \`${row.target}\` does not exist`,
        });
        continue;
      }
      rows.push(row);
    }
  }

  return { rows, problems };
}

/**
 * Builds the glossary from the index rows plus every `terms:` a document
 * declares in its frontmatter.
 *
 * A declared term borrows its owning document's INDEX row description
 * verbatim. A document with no INDEX row has no definition to copy, so its
 * declared terms are reported and dropped rather than invented — the whole
 * point of a generated glossary is that no fact gets a second home.
 */
export function collectTerms(
  docs: NavDoc[],
  rows: IndexRow[],
): { entries: GlossaryEntry[]; problems: NavigationProblem[] } {
  const problems: NavigationProblem[] = [];

  const homeByPath = new Map<string, TermHome>();
  rows.forEach((row, order) => {
    if (homeByPath.has(row.path)) return;
    homeByPath.set(row.path, {
      name: row.name,
      path: row.path,
      href: `./${row.path}`,
      description: row.description,
      order,
    });
  });

  const groups = new Map<string, { entry: GlossaryEntry; minOrder: number }>();

  const add = (term: string, home: TermHome): void => {
    const key = term.trim().toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = { entry: { term, key, homes: [] }, minOrder: Infinity };
      groups.set(key, group);
    }
    // The displayed spelling comes from the lowest-order home, so two
    // capitalisations of the same term cannot swap places between runs.
    if (home.order < group.minOrder) {
      group.minOrder = home.order;
      group.entry.term = term;
    }
    if (!group.entry.homes.some((h) => h.path === home.path)) {
      group.entry.homes.push(home);
    }
  };

  for (const row of rows) {
    const home = homeByPath.get(row.path);
    if (home) add(row.name, home);
  }

  for (const doc of docs) {
    const declared = parseDoc(doc.content).frontmatter?.terms;
    if (!declared) continue;

    for (const term of declared) {
      if (term.trim() === "") {
        problems.push({ file: doc.path, message: "empty term in `terms`" });
        continue;
      }
      const home = homeByPath.get(doc.path);
      if (!home) {
        problems.push({
          file: doc.path,
          message: `declares term "${term.trim()}" but has no index row to copy a definition from`,
        });
        continue;
      }
      add(term, home);
    }
  }

  const entries = [...groups.values()].map((g) => g.entry);
  for (const entry of entries) {
    entry.homes.sort((a, b) => a.order - b.order);
  }
  // `localeCompare` is locale- and ICU-version-dependent; comparing the raw
  // strings keeps the output identical on every machine. Keys are unique
  // after grouping, so no further tie-break is needed.
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  return { entries, problems };
}

/**
 * Inbound link count per document, keyed by docs-root-relative POSIX path.
 *
 * Links from the generated files are ignored: counting them would let one
 * run's output steer the next run's ranking.
 */
export function countInboundLinks(docs: NavDoc[]): Map<string, number> {
  const known = new Set(docs.map((d) => d.path));
  const counts = new Map<string, number>();

  for (const doc of docs) {
    if (GENERATED_FILES.includes(doc.path)) continue;

    for (const link of extractLinks(doc.content, doc.path)) {
      const dir = posix.dirname(doc.path);
      const target = dir === "." ? posix.normalize(link.target) : posix.join(dir, link.target);
      // A document does not promote itself by linking to itself.
      if (!known.has(target) || target === doc.path) continue;
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
  }

  return counts;
}

/**
 * Ranks concept documents by inbound link count and returns the top `limit`,
 * most-linked first.
 *
 * Ties break on index order, which is not a formality: on Saaga's own corpus
 * three concepts tie at ten inbound links, and only index order decides which
 * two of them the README names.
 */
export function rankCoreConcepts(
  docs: NavDoc[],
  rows: IndexRow[],
  limit: number = CORE_CONCEPT_COUNT,
): IndexRow[] {
  const counts = countInboundLinks(docs);

  return rows
    .map((row, order) => ({ row, order }))
    .filter(({ row }) => row.category === "concepts")
    .sort((a, b) => {
      const byCount = (counts.get(b.row.path) ?? 0) - (counts.get(a.row.path) ?? 0);
      return byCount !== 0 ? byCount : a.order - b.order;
    })
    .slice(0, limit)
    .map(({ row }) => row);
}

/**
 * The document's display name: frontmatter `title`, else its first `#`
 * heading, else its basename without the extension. Never invented.
 */
export function docTitle(doc: NavDoc): string {
  const { frontmatter, body } = parseDoc(doc.content);
  if (frontmatter?.title) return frontmatter.title;

  const fence = new FenceScanner();
  for (const line of body.split(/\r?\n/)) {
    if (fence.consume(line) !== "text") continue;
    const m = H1_RE.exec(line);
    if (m) return m[1];
  }

  return posix.basename(doc.path, posix.extname(doc.path));
}

/** Renders the corpus entry point. */
export function renderReadme(model: ReadmeModel): string {
  const lines: string[] = [`# ${model.app} Documentation`, "", README_INTRO, ""];

  lines.push(
    model.architecture
      ? READING_ORDER_WITH_ARCHITECTURE
      : READING_ORDER_WITHOUT_ARCHITECTURE,
    "",
  );

  if (model.architecture) {
    section(lines, "Architecture", "", [model.architecture]);
  }
  section(lines, "Core Concepts", CORE_CONCEPTS_LEAD, model.coreConcepts);
  section(lines, "Workflows and Features", FEATURES_LEAD, model.features);
  section(lines, "Indexes", "", model.indexes);

  return document(
    { title: `${model.app} Documentation`, type: "index" },
    lines,
  );
}

/** Renders the glossary. */
export function renderGlossary(entries: GlossaryEntry[]): string {
  const lines: string[] = ["# Glossary", "", GLOSSARY_INTRO, ""];

  for (const entry of entries) {
    if (entry.homes.length === 1) {
      const home = entry.homes[0];
      lines.push(bullet({ text: entry.term, href: home.href, description: home.description }));
      continue;
    }

    // A term with several homes has no single document to link, so the term
    // itself is plain text and each home gets its own sub-bullet.
    lines.push(`- ${entry.term} — see also:`);
    for (const home of entry.homes) {
      lines.push(
        "  " + bullet({ text: home.name, href: home.href, description: home.description }),
      );
    }
  }

  if (entries.length > 0) lines.push("");

  return document({ title: "Glossary", type: "index" }, lines);
}

/**
 * Builds both navigation files from an in-memory view of the corpus.
 *
 * Pure: identical input bytes produce identical output bytes. The generated
 * files are dropped from the corpus view first, so the previous run's output
 * can never influence this one.
 */
export function buildNavigation(input: BuildNavigationInput): NavigationResult {
  const docs = input.docs.filter((d) => !GENERATED_FILES.includes(d.path));
  const indexes = indexDocs(docs);

  const { rows, problems: rowProblems } = collectIndexRows(docs);
  const { entries, problems: termProblems } = collectTerms(docs, rows);
  const problems = [...rowProblems, ...termProblems];

  if (indexes.length === 0) {
    return {
      files: [],
      problems,
      stats: { indexes: 0, rows: 0, terms: 0, collisions: 0, core_concepts: 0 },
    };
  }

  const coreConcepts = rankCoreConcepts(docs, rows);

  const architectureDoc = docs.find((d) => d.path === "ARCHITECTURE.md");
  if (!architectureDoc) {
    problems.push({
      file: "ARCHITECTURE.md",
      message: "no ARCHITECTURE.md in the corpus; the README omits its section",
    });
  }

  const model: ReadmeModel = {
    app: input.app,
    architecture: architectureDoc
      ? { text: docTitle(architectureDoc), href: "./ARCHITECTURE.md", description: "" }
      : undefined,
    coreConcepts: coreConcepts.map(toNavLink),
    features: rows.filter((r) => r.category === "features").map(toNavLink),
    indexes: [
      ...indexes.map((doc) => ({
        text: docTitle(doc),
        href: `./${doc.path}`,
        description: "",
      })),
      {
        text: "Glossary",
        href: `./${GLOSSARY_FILE}`,
        description: GLOSSARY_LINK_DESCRIPTION,
      },
    ],
  };

  return {
    files: [
      { path: README_FILE, content: renderReadme(model) },
      { path: GLOSSARY_FILE, content: renderGlossary(entries) },
    ],
    problems,
    stats: {
      indexes: indexes.length,
      rows: rows.length,
      terms: entries.length,
      collisions: entries.filter((e) => e.homes.length > 1).length,
      core_concepts: coreConcepts.length,
    },
  };
}

/** Every `INDEX.md` in `docs`, ordered by `CATEGORY_ORDER` then by name. */
function indexDocs(docs: NavDoc[]): NavDoc[] {
  return docs
    .filter((d) => posix.basename(d.path) === "INDEX.md")
    .map((doc) => {
      const dir = posix.dirname(doc.path);
      return { doc, category: dir === "." ? "" : dir };
    })
    .sort((a, b) => {
      const byRank = categoryRank(a.category) - categoryRank(b.category);
      if (byRank !== 0) return byRank;
      return a.category < b.category ? -1 : a.category > b.category ? 1 : 0;
    })
    .map(({ doc }) => doc);
}

function categoryRank(category: string): number {
  const i = CATEGORY_ORDER.indexOf(category);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

function toNavLink(row: IndexRow): NavLink {
  return { text: row.name, href: `./${row.path}`, description: row.description };
}

function bullet(link: NavLink): string {
  const suffix = link.description === "" ? "" : ` — ${link.description}`;
  return `- [${link.text}](${link.href})${suffix}`;
}

/** Appends a `##` section, or nothing at all when it would be empty. */
function section(
  lines: string[],
  title: string,
  lead: string,
  links: NavLink[],
): void {
  if (links.length === 0) return;
  lines.push(`## ${title}`, "");
  if (lead !== "") lines.push(lead, "");
  for (const link of links) lines.push(bullet(link));
  lines.push("");
}

/**
 * Joins rendered lines into a document with frontmatter.
 *
 * Frontmatter goes through `serializeDoc` so field order is fixed and a title
 * containing YAML metacharacters is quoted correctly. Lines are joined with
 * `"\n"` regardless of the input's line endings, and the file ends with
 * exactly one newline.
 */
function document(
  frontmatter: { title: string; type: "index" },
  lines: string[],
): string {
  const body = lines.join("\n").replace(/\n+$/, "") + "\n";
  return serializeDoc(frontmatter, `\n${body}`);
}

function lineCount(text: string): number {
  return text.split(/\r?\n/).length;
}
