import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { listDocFiles } from "../../src/docs/link-graph.js";
import {
  buildNavigation,
  collectIndexRows,
  collectTerms,
  countInboundLinks,
  docTitle,
  GLOSSARY_FILE,
  parseIndex,
  rankCoreConcepts,
  README_FILE,
  renderGlossary,
  type GlossaryEntry,
  type NavDoc,
} from "../../src/docs/navigation.js";

/** A minimal INDEX.md body with the given rows. */
function index(title: string, ...rows: string[]): string {
  return [
    `# ${title} Index`,
    "",
    "| Name | Description |",
    "|------|-------------|",
    ...rows,
    "",
  ].join("\n");
}

function doc(path: string, content: string): NavDoc {
  return { path, content };
}

/**
 * Two concepts, one feature, an architecture page, and the indexes that name
 * them — the smallest corpus that exercises every section of the README.
 */
function smallCorpus(): NavDoc[] {
  return [
    doc("ARCHITECTURE.md", "# Architecture — Demo\n"),
    doc(
      "concepts/INDEX.md",
      index("Concepts", "| [Alpha](./alpha.md) | the first thing |", "| [Beta](./beta.md) | the second thing |"),
    ),
    doc("concepts/alpha.md", "# Alpha\n"),
    doc("concepts/beta.md", "# Beta\n\nSee [Alpha](./alpha.md).\n"),
    doc("features/INDEX.md", index("Features", "| [Doing It](./doing-it.md) | how it gets done |")),
    doc("features/doing-it.md", "# Doing It\n"),
  ];
}

describe("parseIndex", () => {
  test("parses the canonical row shape", () => {
    const { rows, problems } = parseIndex(
      "concepts/INDEX.md",
      index("Concepts", "| [Flow DSL](./flow-dsl.md) | the type system |"),
    );

    expect(problems).toEqual([]);
    expect(rows).toEqual([
      {
        index: "concepts/INDEX.md",
        category: "concepts",
        name: "Flow DSL",
        target: "./flow-dsl.md",
        path: "concepts/flow-dsl.md",
        description: "the type system",
        line: 5,
      },
    ]);
  });

  test("keeps the description verbatim, including inline code spans", () => {
    const description = "The `{var}` system, strict vs. lenient, `renderPrompt()` / `renderPromptFile()`";
    const { rows } = parseIndex("concepts/INDEX.md", index("Concepts", `| [T](./t.md) | ${description} |`));

    expect(rows[0].description).toBe(description);
  });

  test("tolerates a missing separator row", () => {
    const content = ["# Concepts Index", "", "| Name | Description |", "| [A](./a.md) | first |"].join("\n");

    expect(parseIndex("concepts/INDEX.md", content).rows).toHaveLength(1);
  });

  test("tolerates a missing header row", () => {
    const content = ["# Concepts Index", "", "| [A](./a.md) | first |"].join("\n");

    expect(parseIndex("concepts/INDEX.md", content).rows).toHaveLength(1);
  });

  test("tolerates leading and trailing whitespace and CRLF line endings", () => {
    const content = "# Concepts Index\r\n\r\n   | [A](./a.md) | first |   \r\n";
    const { rows, problems } = parseIndex("concepts/INDEX.md", content);

    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({ name: "A", description: "first" });
  });

  test("skips the header and separator rows silently", () => {
    const { rows, problems } = parseIndex("concepts/INDEX.md", index("Concepts"));

    expect(rows).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("skips rows inside a fenced code block", () => {
    const content = [
      "# Concepts Index",
      "",
      "```markdown",
      "| [Example](./example.md) | Brief description |",
      "```",
      "",
      "| [Real](./real.md) | a real row |",
    ].join("\n");
    const { rows, problems } = parseIndex("concepts/INDEX.md", content);

    expect(rows.map((r) => r.name)).toEqual(["Real"]);
    expect(problems).toEqual([]);
  });

  test("reports a pipe line that carries a link but is not a row", () => {
    const content = index("Concepts", "| [Broken](./broken.md | no closing paren |");
    const { rows, problems } = parseIndex("concepts/INDEX.md", content);

    expect(rows).toEqual([]);
    expect(problems).toEqual([
      { file: "concepts/INDEX.md", line: 5, message: "unparseable index row" },
    ]);
  });

  test("reports a row with an empty description but keeps it", () => {
    const { rows, problems } = parseIndex("concepts/INDEX.md", index("Concepts", "| [A](./a.md) |  |"));

    expect(rows[0].description).toBe("");
    expect(problems[0].message).toContain("has no description");
  });

  test("reports a duplicate row for the same target and keeps the first", () => {
    const content = index(
      "Concepts",
      "| [First](./a.md) | first |",
      "| [Second](./a.md) | second |",
    );
    const { rows, problems } = parseIndex("concepts/INDEX.md", content);

    expect(rows.map((r) => r.name)).toEqual(["First"]);
    expect(problems[0]).toMatchObject({ line: 6, message: "duplicate index row for `concepts/a.md`" });
  });

  test("reports a line number relative to the original file when frontmatter is present", () => {
    const content = [
      "---",
      'title: "Concepts Index"',
      "type: index",
      "---",
      "",
      ...index("Concepts", "| [Broken](./broken.md | oops |").split("\n"),
    ].join("\n");
    const { problems } = parseIndex("concepts/INDEX.md", content);

    // The row is the 10th line of the file; without adding the frontmatter
    // offset back it would be reported as line 5.
    expect(problems[0].line).toBe(10);
  });

  test("parses an index with no frontmatter", () => {
    const { rows } = parseIndex("concepts/INDEX.md", index("Concepts", "| [A](./a.md) | first |"));

    expect(rows).toHaveLength(1);
  });

  test("keeps an escaped pipe inside a description", () => {
    const { rows } = parseIndex("concepts/INDEX.md", index("Concepts", "| [A](./a.md) | left \\| right |"));

    expect(rows[0].description).toBe("left \\| right");
  });

  test("resolves a target carrying an anchor to its document", () => {
    const { rows, problems } = parseIndex(
      "concepts/INDEX.md",
      index("Concepts", "| [Alpha](./alpha.md#overview) | the first thing |"),
    );

    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({ path: "concepts/alpha.md", target: "./alpha.md#overview" });
  });

  test.each([
    ["an external URL", "https://example.com/docs"],
    ["a protocol-relative URL", "//example.com/docs"],
    ["a pure anchor", "#section"],
    ["a root-absolute path", "/concepts/alpha.md"],
  ])("reports %s as not a corpus document", (_label, target) => {
    const { rows, problems } = parseIndex(
      "concepts/INDEX.md",
      index("Concepts", `| [Alpha](${target}) | the first thing |`),
    );

    expect(rows).toEqual([]);
    expect(problems[0].message).toBe(
      `index row target \`${target}\` is not a corpus document`,
    );
  });

  test("resolves a ../ target against the index's own directory", () => {
    const { rows } = parseIndex("concepts/INDEX.md", index("Concepts", "| [Arch](../ARCHITECTURE.md) | the shape |"));

    expect(rows[0].path).toBe("ARCHITECTURE.md");
  });
});

describe("collectIndexRows", () => {
  test("orders rows concepts, patterns, conventions, features regardless of directory order", () => {
    const docs = [
      doc("features/INDEX.md", index("Features", "| [F](./f.md) | f |")),
      doc("features/f.md", "# F\n"),
      doc("conventions/INDEX.md", index("Conventions", "| [V](./v.md) | v |")),
      doc("conventions/v.md", "# V\n"),
      doc("patterns/INDEX.md", index("Patterns", "| [P](./p.md) | p |")),
      doc("patterns/p.md", "# P\n"),
      doc("concepts/INDEX.md", index("Concepts", "| [C](./c.md) | c |")),
      doc("concepts/c.md", "# C\n"),
    ];

    expect(collectIndexRows(docs).rows.map((r) => r.name)).toEqual([
      "C",
      "P",
      "V",
      "F",
    ]);
  });

  test("a corpus without conventions keeps the other three in order", () => {
    // The category is optional — most repositories have no lexical rules worth
    // a document — so its absence must not disturb anything.
    const docs = [
      doc("features/INDEX.md", index("Features", "| [F](./f.md) | f |")),
      doc("features/f.md", "# F\n"),
      doc("patterns/INDEX.md", index("Patterns", "| [P](./p.md) | p |")),
      doc("patterns/p.md", "# P\n"),
      doc("concepts/INDEX.md", index("Concepts", "| [C](./c.md) | c |")),
      doc("concepts/c.md", "# C\n"),
    ];

    expect(collectIndexRows(docs).rows.map((r) => r.name)).toEqual(["C", "P", "F"]);
  });

  test("appends unknown category directories after the known ones, sorted", () => {
    const docs = [
      doc("zebras/INDEX.md", index("Zebras", "| [Z](./z.md) | z |")),
      doc("zebras/z.md", "# Z\n"),
      doc("aardvarks/INDEX.md", index("Aardvarks", "| [A](./a.md) | a |")),
      doc("aardvarks/a.md", "# A\n"),
      doc("concepts/INDEX.md", index("Concepts", "| [C](./c.md) | c |")),
      doc("concepts/c.md", "# C\n"),
    ];

    expect(collectIndexRows(docs).rows.map((r) => r.name)).toEqual(["C", "A", "Z"]);
  });

  test("drops and reports a row whose target does not exist", () => {
    const docs = [doc("concepts/INDEX.md", index("Concepts", "| [Gone](./gone.md) | deleted |"))];
    const { rows, problems } = collectIndexRows(docs);

    expect(rows).toEqual([]);
    expect(problems[0].message).toContain("does not exist");
  });

  test("drops and reports a row whose target is not a Markdown document", () => {
    const docs = [doc("concepts/INDEX.md", index("Concepts", "| [Code](./thing.ts) | source |"))];
    const { rows, problems } = collectIndexRows(docs);

    expect(rows).toEqual([]);
    expect(problems[0].message).toContain("is not a corpus document");
  });

  test("drops and reports a row that escapes the docs root", () => {
    const docs = [doc("concepts/INDEX.md", index("Concepts", "| [Out](../../outside.md) | elsewhere |"))];
    const { rows, problems } = collectIndexRows(docs);

    expect(rows).toEqual([]);
    expect(problems[0].message).toContain("is not a corpus document");
  });
});

describe("rankCoreConcepts", () => {
  /** `n` documents each linking to `concepts/<target>`. */
  function linkers(target: string, n: number): NavDoc[] {
    return Array.from({ length: n }, (_, i) =>
      doc(`features/linker-${i}.md`, `# Linker ${i}\n\nSee [x](../concepts/${target}).\n`),
    );
  }

  const ranked = (docs: NavDoc[], limit?: number) =>
    rankCoreConcepts(docs, collectIndexRows(docs).rows, limit).map((r) => r.name);

  test("ranks by inbound link count, most-linked first", () => {
    const docs = [
      doc("concepts/INDEX.md", index("Concepts", "| [A](./a.md) | a |", "| [B](./b.md) | b |")),
      doc("concepts/a.md", "# A\n"),
      doc("concepts/b.md", "# B\n"),
      ...linkers("a.md", 1),
      ...linkers("b.md", 3),
    ];

    expect(ranked(docs)).toEqual(["B", "A"]);
  });

  test("breaks a tie by index order", () => {
    // Three concepts tied at one inbound link each — exactly the shape of the
    // real corpus, where only index order decides which two the README names.
    const docs = [
      doc(
        "concepts/INDEX.md",
        index(
          "Concepts",
          "| [First](./first.md) | 1 |",
          "| [Second](./second.md) | 2 |",
          "| [Third](./third.md) | 3 |",
        ),
      ),
      doc("concepts/first.md", "# First\n"),
      doc("concepts/second.md", "# Second\n"),
      doc("concepts/third.md", "# Third\n"),
      ...linkers("first.md", 1),
      ...linkers("second.md", 1).map((d) => doc(d.path.replace("linker", "l2"), d.content)),
      ...linkers("third.md", 1).map((d) => doc(d.path.replace("linker", "l3"), d.content)),
    ];

    expect(ranked(docs, 2)).toEqual(["First", "Second"]);
  });

  test("ignores links from a previous run's generated files", () => {
    const base = [
      doc("concepts/INDEX.md", index("Concepts", "| [A](./a.md) | a |", "| [B](./b.md) | b |")),
      doc("concepts/a.md", "# A\n"),
      doc("concepts/b.md", "# B\n"),
      ...linkers("b.md", 2),
    ];
    const withGenerated = [
      ...base,
      doc(README_FILE, "# Docs\n\n- [A](./concepts/a.md)\n- [A again](./concepts/a.md)\n- [A more](./concepts/a.md)\n"),
      doc(GLOSSARY_FILE, "# Glossary\n\n- [A](./concepts/a.md)\n"),
    ];

    expect(ranked(withGenerated)).toEqual(ranked(base));
  });

  test("ignores links inside code fences and code spans", () => {
    const docs = [
      doc("concepts/INDEX.md", index("Concepts", "| [A](./a.md) | a |", "| [B](./b.md) | b |")),
      doc("concepts/a.md", "# A\n"),
      doc("concepts/b.md", "# B\n"),
      doc(
        "features/quoted.md",
        ["# Quoted", "", "```md", "[A](../concepts/a.md)", "```", "", "`[A](../concepts/a.md)`", "", "See [B](../concepts/b.md)."].join("\n"),
      ),
    ];

    expect(ranked(docs)).toEqual(["B", "A"]);
  });

  test("does not let a document promote itself by linking to itself", () => {
    const docs = [
      doc("concepts/INDEX.md", index("Concepts", "| [A](./a.md) | a |", "| [B](./b.md) | b |")),
      doc("concepts/a.md", "# A\n\nSee [A](./a.md) and [A](./a.md).\n"),
      doc("concepts/b.md", "# B\n"),
      ...linkers("b.md", 1),
    ];

    expect(ranked(docs)).toEqual(["B", "A"]);
  });

  test("returns fewer than the limit when there are fewer concepts", () => {
    expect(ranked(smallCorpus(), 4)).toHaveLength(2);
  });

  test("considers only documents in the concepts category", () => {
    // "Doing It" is a feature and is never a candidate, however linked it is.
    expect(ranked(smallCorpus())).toEqual(["Alpha", "Beta"]);
  });

  test("counts an inbound link that carries an anchor", () => {
    // `validateCorpus` strips anchors before resolving, so counting them here
    // too is what keeps reachability and ranking reading the same graph.
    const docs = [
      doc("concepts/INDEX.md", index("Concepts", "| [A](./a.md) | a |", "| [B](./b.md) | b |")),
      doc("concepts/a.md", "# A\n"),
      doc("concepts/b.md", "# B\n"),
      doc("features/uses.md", "# Uses\n\nSee [A](../concepts/a.md#overview).\n"),
    ];

    expect(countInboundLinks(docs).get("concepts/a.md")).toBe(2);
    expect(ranked(docs)).toEqual(["A", "B"]);
  });

  test("ignores a link that addresses no corpus document", () => {
    const docs = [
      doc("concepts/INDEX.md", index("Concepts", "| [A](./a.md) | a |")),
      doc("concepts/a.md", "# A\n\n[out](https://example.com) [up](#top) [root](/x.md)\n"),
    ];

    expect(countInboundLinks(docs).get("concepts/a.md")).toBe(1);
  });

  test("countInboundLinks counts every corpus link once", () => {
    const counts = countInboundLinks(smallCorpus());

    expect(counts.get("concepts/alpha.md")).toBe(2); // the INDEX and beta.md
    expect(counts.get("concepts/beta.md")).toBe(1);
  });
});

describe("collectTerms", () => {
  const terms = (docs: NavDoc[]) => collectTerms(docs, collectIndexRows(docs).rows);

  test("every index row contributes a term with its verbatim description", () => {
    const { entries, problems } = terms(smallCorpus());

    expect(problems).toEqual([]);
    expect(entries.map((e) => e.term)).toEqual(["Alpha", "Beta", "Doing It"]);
    expect(entries[0].homes[0]).toMatchObject({
      path: "concepts/alpha.md",
      href: "./concepts/alpha.md",
      description: "the first thing",
    });
  });

  test("a declared term borrows its document's index row description verbatim", () => {
    const docs = smallCorpus().map((d) =>
      d.path === "concepts/alpha.md"
        ? doc(d.path, "---\ntitle: Alpha\ntype: concept\nterms:\n  - aleph\n---\n\n# Alpha\n")
        : d,
    );
    const { entries } = terms(docs);
    const aleph = entries.find((e) => e.key === "aleph");

    expect(aleph?.homes).toHaveLength(1);
    expect(aleph?.homes[0].description).toBe("the first thing");
  });

  test("a term claimed by two documents becomes a see-also entry", () => {
    const docs = smallCorpus().map((d) => {
      if (d.path === "concepts/alpha.md") {
        return doc(d.path, "---\ntitle: Alpha\ntype: concept\nterms:\n  - phase\n---\n\n# Alpha\n");
      }
      if (d.path === "features/doing-it.md") {
        return doc(d.path, "---\ntitle: Doing It\ntype: feature\nterms:\n  - phase\n---\n\n# Doing It\n");
      }
      return d;
    });
    const phase = terms(docs).entries.find((e) => e.key === "phase");

    expect(phase?.homes.map((h) => h.path)).toEqual(["concepts/alpha.md", "features/doing-it.md"]);
    expect(phase?.homes.map((h) => h.description)).toEqual(["the first thing", "how it gets done"]);
  });

  test("see-also homes are ordered by index order, not document order", () => {
    // `features/doing-it.md` sorts before `concepts/alpha.md` alphabetically,
    // so document order and index order genuinely disagree here.
    const docs = [
      doc("features/INDEX.md", index("Features", "| [Doing It](./doing-it.md) | how it gets done |")),
      doc("features/doing-it.md", "---\ntitle: Doing It\ntype: feature\nterms:\n  - phase\n---\n\n# Doing It\n"),
      doc("concepts/INDEX.md", index("Concepts", "| [Alpha](./alpha.md) | the first thing |")),
      doc("concepts/alpha.md", "---\ntitle: Alpha\ntype: concept\nterms:\n  - phase\n---\n\n# Alpha\n"),
    ];
    const phase = terms(docs).entries.find((e) => e.key === "phase");

    expect(phase?.homes.map((h) => h.path)).toEqual(["concepts/alpha.md", "features/doing-it.md"]);
  });

  test("a document declaring its own index row name does not collide with itself", () => {
    const docs = smallCorpus().map((d) =>
      d.path === "concepts/alpha.md"
        ? doc(d.path, "---\ntitle: Alpha\ntype: concept\nterms:\n  - Alpha\n---\n\n# Alpha\n")
        : d,
    );
    const { entries } = terms(docs);

    expect(entries.filter((e) => e.key === "alpha")).toHaveLength(1);
    expect(entries.find((e) => e.key === "alpha")?.homes).toHaveLength(1);
  });

  test("reports and drops a term whose document has no index row", () => {
    const docs = smallCorpus().map((d) =>
      d.path === "ARCHITECTURE.md"
        ? doc(d.path, "---\ntitle: Arch\ntype: architecture\nterms:\n  - shape\n---\n\n# Arch\n")
        : d,
    );
    const { entries, problems } = terms(docs);

    expect(entries.some((e) => e.key === "shape")).toBe(false);
    expect(problems[0]).toMatchObject({
      file: "ARCHITECTURE.md",
      message: 'declares term "shape" but has no index row to copy a definition from',
    });
  });

  test("groups terms case-insensitively and displays the lowest-index-order spelling", () => {
    const docs = smallCorpus().map((d) => {
      if (d.path === "concepts/alpha.md") {
        return doc(d.path, "---\ntitle: Alpha\ntype: concept\nterms:\n  - Scope\n---\n\n# Alpha\n");
      }
      if (d.path === "features/doing-it.md") {
        return doc(d.path, "---\ntitle: Doing It\ntype: feature\nterms:\n  - scope\n---\n\n# Doing It\n");
      }
      return d;
    });
    const scope = terms(docs).entries.find((e) => e.key === "scope");

    expect(scope?.term).toBe("Scope");
    expect(scope?.homes).toHaveLength(2);
  });

  test("reports and drops an empty or whitespace-only term", () => {
    const docs = smallCorpus().map((d) =>
      d.path === "concepts/alpha.md"
        ? doc(d.path, '---\ntitle: Alpha\ntype: concept\nterms:\n  - "   "\n---\n\n# Alpha\n')
        : d,
    );
    const { entries, problems } = terms(docs);

    expect(entries.map((e) => e.term)).toEqual(["Alpha", "Beta", "Doing It"]);
    expect(problems[0].message).toBe("empty term in `terms`");
  });

  test("a document with no frontmatter contributes only its index row term", () => {
    const { entries, problems } = terms(smallCorpus());

    expect(problems).toEqual([]);
    expect(entries).toHaveLength(3);
  });
});

describe("renderReadme", () => {
  /** The README `buildNavigation` produces for `docs`. */
  const build = (docs: NavDoc[]) => buildNavigation({ app: "demo", docs }).files[0].content;
  const readme = () => build(smallCorpus());

  test("renders the reading order: architecture, core concepts, workflows, indexes", () => {
    const content = build(smallCorpus());
    const headings = content.split("\n").filter((l) => l.startsWith("## "));

    expect(headings).toEqual([
      "## Architecture",
      "## Core Concepts",
      "## Workflows and Features",
      "## Indexes",
    ]);
  });

  test("carries index frontmatter with the app name in the title", () => {
    expect(build(smallCorpus())).toMatch(
      /^---\ntitle: demo Documentation\ntype: index\n---\n\n# demo Documentation\n/,
    );
  });

  test("omits the architecture section and adjusts the intro when ARCHITECTURE.md is missing", () => {
    const docs = smallCorpus().filter((d) => d.path !== "ARCHITECTURE.md");
    const content = build(docs);

    expect(content).not.toContain("## Architecture");
    expect(content).toContain("Read in order: the core concepts, then the workflows.");
    expect(content).not.toContain("Read in order: the architecture");
  });

  test("omits an empty section rather than emitting a bare heading", () => {
    const docs = smallCorpus().filter((d) => !d.path.startsWith("features/"));
    const content = build(docs);

    expect(content).not.toContain("## Workflows and Features");
    expect(content).toContain("## Core Concepts");
  });

  test("omits the em dash when a description is empty", () => {
    const docs = smallCorpus().map((d) =>
      d.path === "features/INDEX.md" ? doc(d.path, index("Features", "| [Doing It](./doing-it.md) |  |")) : d,
    );

    expect(build(docs)).toContain("- [Doing It](./features/doing-it.md)\n");
  });

  test("contains no date, timestamp, or run id", () => {
    expect(readme()).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2}|Generated:/);
  });

  test("links the glossary, which is not orphan-exempt", () => {
    expect(readme()).toContain(`](./${GLOSSARY_FILE})`);
  });

  test("links ARCHITECTURE.md using its own heading", () => {
    expect(readme()).toContain("- [Architecture — Demo](./ARCHITECTURE.md)");
  });
});

describe("renderGlossary", () => {
  function entry(term: string, ...homes: [string, string][]): GlossaryEntry {
    return {
      term,
      key: term.toLowerCase(),
      homes: homes.map(([name, path], order) => ({
        name,
        path,
        href: `./${path}`,
        description: `what ${name} is`,
        order,
      })),
    };
  }

  test("renders a single-home entry as a link followed by its verbatim definition", () => {
    expect(renderGlossary([entry("Alpha", ["Alpha", "concepts/alpha.md"])])).toContain(
      "- [Alpha](./concepts/alpha.md) — what Alpha is",
    );
  });

  test("renders a colliding term as a see-also entry with one sub-bullet per home", () => {
    const content = renderGlossary([
      entry("phase", ["Output", "concepts/output.md"], ["Plan Parsing", "features/plan.md"]),
    ]);

    expect(content).toContain("- phase — see also:");
    expect(content).toContain("  - [Output](./concepts/output.md) — what Output is");
    expect(content).toContain("  - [Plan Parsing](./features/plan.md) — what Plan Parsing is");
  });

  test("renders an alias as a first-class entry pointing at the same document", () => {
    const content = renderGlossary([
      entry("Alpha", ["Alpha", "concepts/alpha.md"]),
      entry("aleph", ["Alpha", "concepts/alpha.md"]),
    ]);

    expect(content).toContain("- [Alpha](./concepts/alpha.md)");
    expect(content).toContain("- [aleph](./concepts/alpha.md)");
  });

  test("sorts entries case-insensitively without locale collation", () => {
    // `localeCompare` would place "ä" next to "a"; code-unit order puts it
    // after "z", and only code-unit order is machine-independent.
    const docs = [
      doc(
        "concepts/INDEX.md",
        index("Concepts", "| [zeta](./z.md) | z |", "| [ähnlich](./ae.md) | ae |", "| [Alpha](./a.md) | a |"),
      ),
      doc("concepts/z.md", "# z\n"),
      doc("concepts/ae.md", "# ae\n"),
      doc("concepts/a.md", "# a\n"),
    ];
    const { entries } = collectTerms(docs, collectIndexRows(docs).rows);

    expect(entries.map((e) => e.term)).toEqual(["Alpha", "zeta", "ähnlich"]);
  });

  test("ends with exactly one newline", () => {
    const content = renderGlossary([entry("Alpha", ["Alpha", "concepts/alpha.md"])]);

    expect(content.endsWith("\n")).toBe(true);
    expect(content.endsWith("\n\n")).toBe(false);
  });
});

describe("buildNavigation", () => {
  test("returns no files when the corpus has no INDEX", () => {
    const result = buildNavigation({ app: "demo", docs: [doc("ARCHITECTURE.md", "# Arch\n")] });

    expect(result.files).toEqual([]);
    expect(result.stats).toEqual({ indexes: 0, rows: 0, terms: 0, collisions: 0, core_concepts: 0 });
  });

  test("is a pure function of the non-generated corpus", () => {
    const docs = smallCorpus();
    const first = buildNavigation({ app: "demo", docs });

    // Fold the first run's output back in, exactly as a second flow run would
    // find it on disk. Without the GENERATED_FILES filter the glossary's links
    // would re-rank the core concepts.
    const second = buildNavigation({ app: "demo", docs: [...docs, ...first.files] });

    expect(second.files).toEqual(first.files);
    expect(second.stats).toEqual(first.stats);
  });

  test("reports the missing architecture page without failing", () => {
    const docs = smallCorpus().filter((d) => d.path !== "ARCHITECTURE.md");
    const result = buildNavigation({ app: "demo", docs });

    expect(result.files).toHaveLength(2);
    expect(result.problems.map((p) => p.file)).toContain("ARCHITECTURE.md");
  });

  test("counts indexes, rows, terms, collisions, and core concepts", () => {
    const docs = smallCorpus().map((d) => {
      if (d.path === "concepts/alpha.md") {
        return doc(d.path, "---\ntitle: Alpha\ntype: concept\nterms:\n  - phase\n---\n\n# Alpha\n");
      }
      if (d.path === "features/doing-it.md") {
        return doc(d.path, "---\ntitle: Doing It\ntype: feature\nterms:\n  - phase\n---\n\n# Doing It\n");
      }
      return d;
    });

    expect(buildNavigation({ app: "demo", docs }).stats).toEqual({
      indexes: 2,
      rows: 3,
      terms: 4,
      collisions: 1,
      core_concepts: 2,
    });
  });

  test("writes README.md first and GLOSSARY.md second", () => {
    expect(buildNavigation({ app: "demo", docs: smallCorpus() }).files.map((f) => f.path)).toEqual([
      README_FILE,
      GLOSSARY_FILE,
    ]);
  });
});

describe("docTitle", () => {
  test("prefers the frontmatter title", () => {
    expect(docTitle(doc("a.md", "---\ntitle: From Frontmatter\ntype: concept\n---\n\n# From Heading\n"))).toBe(
      "From Frontmatter",
    );
  });

  test("falls back to the first level-one heading", () => {
    expect(docTitle(doc("a.md", "# From Heading\n\n## Not This\n"))).toBe("From Heading");
  });

  test("falls back to the basename when there is neither", () => {
    expect(docTitle(doc("concepts/run-context.md", "no heading here\n"))).toBe("run-context");
  });
});

describe("the real corpus", () => {
  const docsRoot = new URL("../../saaga-docs/", import.meta.url).pathname;

  test("every row of every real INDEX parses with no problems", async () => {
    const paths = await listDocFiles(docsRoot);
    const docs = await Promise.all(
      paths.map(async (path) => doc(path, await readFile(join(docsRoot, path), "utf8"))),
    );

    const { rows, problems } = collectIndexRows(docs);

    expect(problems).toEqual([]);
    expect(rows.length).toBeGreaterThan(0);
  });
});
