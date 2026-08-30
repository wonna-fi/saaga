import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  extractLinks,
  extractMermaidFences,
  listDocFiles,
} from "../../src/docs/link-graph.js";

async function writeAt(dir: string, rel: string, content: string): Promise<void> {
  const p = join(dir, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, content, "utf8");
}

describe("link-graph: listDocFiles", () => {
  test("returns every markdown file, sorted, POSIX-relative", async () => {
    const root = await mkdtemp(join(tmpdir(), "saaga-lg-"));
    await writeAt(root, "concepts/b.md", "b");
    await writeAt(root, "concepts/a.md", "a");
    await writeAt(root, "ARCHITECTURE.md", "arch");

    expect(await listDocFiles(root)).toEqual([
      "ARCHITECTURE.md",
      "concepts/a.md",
      "concepts/b.md",
    ]);
  });

  test("skips non-markdown corpus files, metadata/, and dot-directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "saaga-lg-"));
    await writeAt(root, "a.md", "a");
    await writeAt(root, "BASELINE", "hashes");
    await writeAt(root, "FORMAT", "format_version: 1");
    await writeAt(root, "metadata/quick_updates/run-1/summary.md", "summary");
    await writeAt(root, ".hidden/x.md", "x");

    expect(await listDocFiles(root)).toEqual(["a.md"]);
  });

  test("returns an empty list for a directory that does not exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "saaga-lg-"));
    expect(await listDocFiles(join(root, "nope"))).toEqual([]);
  });
});

describe("link-graph: extractLinks", () => {
  test("extracts both corpus link shapes with line numbers", () => {
    const md = [
      "# Title",
      "",
      "See [Flow DSL](./flow-dsl.md) for details.",
      "",
      "| Name | Note |",
      "| [Backend](../concepts/backend-resolution.md) | how it resolves |",
    ].join("\n");

    expect(extractLinks(md, "features/x.md")).toEqual([
      { from: "features/x.md", target: "./flow-dsl.md", line: 3 },
      {
        from: "features/x.md",
        target: "../concepts/backend-resolution.md",
        line: 6,
      },
    ]);
  });

  test("ignores links inside fenced code blocks and inline code spans", () => {
    const md = [
      "Real [one](./a.md).",
      "",
      "```markdown",
      "[example](./not-a-real-doc.md)",
      "```",
      "",
      "Quoted `[example](./also-not-real.md)` stays out.",
    ].join("\n");

    expect(extractLinks(md, "a.md").map((l) => l.target)).toEqual(["./a.md"]);
  });

  test("does not mistake a TypeScript non-null assertion for an image link", () => {
    // `m![1]` appears verbatim in patterns/testing-with-fake-agent.md.
    const md = ["```ts", "const p = prompt.match(RE)![1];", "```", "", "m![1]"].join(
      "\n",
    );
    expect(extractLinks(md, "a.md")).toEqual([]);
  });

  test("treats an image target as a link", () => {
    expect(extractLinks("![alt](./diagram.png)", "a.md")).toEqual([
      { from: "a.md", target: "./diagram.png", line: 1 },
    ]);
  });

  test("keeps external, anchor and titled targets verbatim", () => {
    const md = [
      "[ext](https://example.com)",
      "[anchor](#section)",
      '[titled](./a.md "A title")',
    ].join("\n");

    expect(extractLinks(md, "x.md").map((l) => l.target)).toEqual([
      "https://example.com",
      "#section",
      "./a.md",
    ]);
  });
});

describe("link-graph: extractMermaidFences", () => {
  test("extracts a mermaid fence with its opening line number", () => {
    const md = ["# Title", "", "```mermaid", "flowchart TD", "  A --> B", "```"].join(
      "\n",
    );

    expect(extractMermaidFences(md)).toEqual([
      { line: 3, body: "flowchart TD\n  A --> B" },
    ]);
  });

  test("ignores non-mermaid fences", () => {
    const md = ["```ts", "const x = 1;", "```", "", "```", "plain", "```"].join("\n");
    expect(extractMermaidFences(md)).toEqual([]);
  });

  test("a longer fence is not closed by a shorter one inside it", () => {
    const md = ["````mermaid", "flowchart TD", "```", "  A --> B", "````"].join("\n");
    expect(extractMermaidFences(md)).toEqual([
      { line: 1, body: "flowchart TD\n```\n  A --> B" },
    ]);
  });
});
