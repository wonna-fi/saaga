import { describe, expect, test } from "vitest";
import {
  validateCorpus,
  validateMermaidFence,
  type DocInput,
} from "../../src/docs/validate.js";

/** Existence probe backed by the fixture's own document set. */
function existsIn(docs: DocInput[], extra: string[] = []) {
  const known = new Set([...docs.map((d) => d.path), ...extra]);
  return (relPath: string) => Promise.resolve(known.has(relPath));
}

async function validate(docs: DocInput[], extra: string[] = []) {
  return validateCorpus(docs, { exists: existsIn(docs, extra) });
}

describe("validate: links", () => {
  test("a clean tree reports nothing", async () => {
    const docs: DocInput[] = [
      {
        path: "concepts/INDEX.md",
        content: "| [A](./a.md) | first |\n| [B](./b.md) | second |",
      },
      { path: "concepts/a.md", content: "See [B](./b.md)." },
      { path: "concepts/b.md", content: "See [A](../concepts/a.md)." },
    ];

    const report = await validate(docs);
    expect(report.brokenLinks).toEqual([]);
    expect(report.invalidMermaid).toEqual([]);
    expect(report.orphans).toEqual([]);
    expect(report.filesChecked).toBe(3);
  });

  test("reports an unresolved target with its file and line", async () => {
    const docs: DocInput[] = [
      { path: "concepts/INDEX.md", content: "| [A](./a.md) | first |" },
      { path: "concepts/a.md", content: "intro\n\nSee [X](./missing.md)." },
    ];

    const report = await validate(docs);
    expect(report.brokenLinks).toEqual([
      {
        kind: "broken-link",
        file: "concepts/a.md",
        line: 3,
        message: "unresolved link target `./missing.md`",
      },
    ]);
  });

  test("a link to real source outside the docs root is not reported", async () => {
    const docs: DocInput[] = [
      { path: "concepts/INDEX.md", content: "| [A](./a.md) | first |" },
      { path: "concepts/a.md", content: "See [cli](../../src/cli.ts)." },
    ];

    const report = await validate(docs, ["../src/cli.ts"]);
    expect(report.brokenLinks).toEqual([]);
  });

  test("external, anchor-only and root-absolute targets are not resolved", async () => {
    const docs: DocInput[] = [
      {
        path: "INDEX.md",
        content:
          "[ext](https://example.com) [mail](mailto:a@b.c) [here](#top) [abs](/x.md)",
      },
    ];

    expect((await validate(docs)).brokenLinks).toEqual([]);
  });

  test("an anchor suffix is stripped before resolving, not validated", async () => {
    const docs: DocInput[] = [
      { path: "INDEX.md", content: "[A](./a.md#nonexistent-heading)" },
      { path: "a.md", content: "# A" },
    ];

    const report = await validate(docs);
    expect(report.brokenLinks).toEqual([]);
    expect(report.orphans).toEqual([]);
  });
});

describe("validate: orphans", () => {
  test("a document nothing links to is an orphan but not an error", async () => {
    const docs: DocInput[] = [
      { path: "concepts/INDEX.md", content: "| [A](./a.md) | first |" },
      { path: "concepts/a.md", content: "# A" },
      { path: "concepts/lonely.md", content: "# Lonely" },
    ];

    const report = await validate(docs);
    expect(report.brokenLinks).toEqual([]);
    expect(report.orphans).toEqual([
      {
        kind: "orphan",
        file: "concepts/lonely.md",
        message: "no inbound links from any other document",
      },
    ]);
  });

  test("INDEX.md and a root README.md are entry points, never orphans", async () => {
    const docs: DocInput[] = [
      { path: "README.md", content: "# Corpus" },
      { path: "concepts/INDEX.md", content: "# Concepts" },
      { path: "features/INDEX.md", content: "# Features" },
    ];

    expect((await validate(docs)).orphans).toEqual([]);
  });

  test("ARCHITECTURE.md is not an entry point — an unlinked one is reported", async () => {
    const docs: DocInput[] = [
      { path: "ARCHITECTURE.md", content: "# Architecture" },
      { path: "concepts/INDEX.md", content: "# Concepts" },
    ];

    expect((await validate(docs)).orphans.map((o) => o.file)).toEqual([
      "ARCHITECTURE.md",
    ]);
  });

  test("a self-link does not de-orphan a document", async () => {
    const docs: DocInput[] = [
      { path: "INDEX.md", content: "# Index" },
      { path: "a.md", content: "[me](./a.md)" },
    ];

    expect((await validate(docs)).orphans.map((o) => o.file)).toEqual(["a.md"]);
  });
});

describe("validate: mermaid", () => {
  /** Verbatim from saaga-docs/ARCHITECTURE.md — the corpus must keep passing. */
  const REAL_FENCE = [
    "flowchart TD",
    "    A[CLI Subcommand] --> B[Resolve Agent Backend]",
    "    E --> F{Step Type?}",
    "    F -->|agent| G[Render Prompt Template]",
    "    F -->|foreach / loop / if| L[Control Flow]",
    "",
    "    style A fill:#4A90D9,color:#fff",
  ].join("\n");

  test("accepts the real corpus diagram", () => {
    expect(validateMermaidFence(REAL_FENCE)).toBeNull();
  });

  test("accepts a bottom-up flowchart and a diagram with no direction", () => {
    expect(validateMermaidFence("flowchart BT\n  a --> b")).toBeNull();
    expect(validateMermaidFence("sequenceDiagram\n  A->>B: hi")).toBeNull();
  });

  test("accepts %% comments and a trailing semicolon on the header", () => {
    expect(validateMermaidFence("%% a note\ngraph LR;\n  a --> b")).toBeNull();
  });

  test("rejects an unknown diagram type", () => {
    expect(validateMermaidFence("flowcart TD\n  A --> B")).toBe(
      "unknown diagram type `flowcart`",
    );
  });

  test("rejects an invalid flowchart direction", () => {
    expect(validateMermaidFence("flowchart SIDEWAYS\n  A --> B")).toBe(
      "invalid flowchart direction `SIDEWAYS`",
    );
  });

  test("rejects unbalanced brackets — the truncated-diagram case", () => {
    expect(validateMermaidFence("flowchart TD\n  A[CLI --> B[Backend]")).toBe(
      "unbalanced brackets",
    );
  });

  test("rejects unbalanced quotes", () => {
    expect(validateMermaidFence('flowchart TD\n  A["label] --> B')).toBe(
      "unbalanced quotes",
    );
  });

  test("a bracket inside a quoted label does not count", () => {
    expect(validateMermaidFence('flowchart TD\n  A["a [ b"] --> B')).toBeNull();
  });

  test("rejects an empty or comment-only fence", () => {
    expect(validateMermaidFence("")).toBe("empty diagram");
    expect(validateMermaidFence("%% nothing here\n\n")).toBe("empty diagram");
  });

  test("an invalid fence is reported with its file and line", async () => {
    const docs: DocInput[] = [
      {
        path: "INDEX.md",
        content: ["# Index", "", "```mermaid", "nope TD", "```"].join("\n"),
      },
    ];

    expect((await validate(docs)).invalidMermaid).toEqual([
      {
        kind: "invalid-mermaid",
        file: "INDEX.md",
        line: 3,
        message: "unknown diagram type `nope`",
      },
    ]);
  });
});
