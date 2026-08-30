import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { DEFAULT_DOCS_DIR } from "../../src/cli/config.js";
import { CONVENTION_MAX_BODY_LINES } from "../../src/docs/validate.js";
import { validateDocs } from "../../src/scripts/validate-docs.js";

async function writeAt(dir: string, rel: string, content: string): Promise<void> {
  const p = join(dir, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, content, "utf8");
}

/** An app with a small, fully-linked corpus and one valid diagram. */
async function cleanApp(): Promise<{ app: string; outDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "saaga-vd-"));
  const app = join(root, "app");
  const docs = join(app, DEFAULT_DOCS_DIR);

  await writeAt(app, "src/cli.ts", "export {};");
  await writeAt(
    docs,
    "concepts/INDEX.md",
    [
      "# Concepts Index",
      "",
      "| Name | Description |",
      "|------|-------------|",
      "| [Alpha](./alpha.md) | the first |",
      "| [Beta](./beta.md) | the second |",
    ].join("\n"),
  );
  await writeAt(
    docs,
    "concepts/alpha.md",
    [
      "# Alpha",
      "",
      "See [Beta](./beta.md).",
      "",
      "```mermaid",
      "flowchart TD",
      "    A[CLI Subcommand] --> B[Resolve Agent Backend]",
      "    F -->|agent| G[Render Prompt Template]",
      "",
      "    style A fill:#4A90D9,color:#fff",
      "```",
    ].join("\n"),
  );
  await writeAt(docs, "concepts/beta.md", "# Beta\n\nSee [Alpha](./alpha.md).");

  const outDir = join(root, "out");
  return { app, outDir };
}

function run(app: string, outDir: string, warn?: (m: string) => void) {
  return validateDocs(
    { app_dir: app, docs_dir: DEFAULT_DOCS_DIR, output_dir: outDir },
    { cwd: app, warn },
  );
}

describe("validate-docs: a clean corpus", () => {
  test("passes and writes an all-clear report", async () => {
    const { app, outDir } = await cleanApp();

    const result = await run(app, outDir);
    expect(result).toMatchObject({
      files_checked: 3,
      broken_links: 0,
      invalid_diagrams: 0,
      orphans: 0,
      oversized_conventions: 0,
    });
    expect(result.report_path).toBe(join(outDir, "doc-validation.md"));

    const report = await readFile(result.report_path, "utf8");
    expect(report).toContain("# Documentation Validation");
    expect(report).toContain(
      "Summary: 0 broken links, 0 invalid diagrams, 0 orphans, 0 over-cap conventions.",
    );
    expect(report.match(/_None_/g)).toHaveLength(4);
  });

  test("does not warn when there is nothing to warn about", async () => {
    const { app, outDir } = await cleanApp();
    const warn = vi.fn();
    await run(app, outDir, warn);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("validate-docs: fatal problems", () => {
  test("a broken link fails the flow and names the report", async () => {
    const { app, outDir } = await cleanApp();
    await writeAt(
      app,
      `${DEFAULT_DOCS_DIR}/concepts/beta.md`,
      "# Beta\n\nSee [Gone](./missing.md).",
    );

    await expect(run(app, outDir)).rejects.toThrow(/^validate-docs: /);
    await expect(run(app, outDir)).rejects.toThrow(/1 broken link\b/);
    await expect(run(app, outDir)).rejects.toThrow(
      new RegExp(join(outDir, "doc-validation.md").replace(/[\\/]/g, "\\$&")),
    );

    // The report is written even though the script threw.
    const report = await readFile(join(outDir, "doc-validation.md"), "utf8");
    expect(report).toMatch(
      /## Broken Links\s+- `concepts\/beta\.md:3` — unresolved link target `\.\/missing\.md`/,
    );
  });

  test("an unknown diagram type fails the flow", async () => {
    const { app, outDir } = await cleanApp();
    await writeAt(
      app,
      `${DEFAULT_DOCS_DIR}/concepts/beta.md`,
      ["# Beta", "", "[Alpha](./alpha.md)", "", "```mermaid", "flowcart TD", "```"].join(
        "\n",
      ),
    );

    await expect(run(app, outDir)).rejects.toThrow(/1 invalid Mermaid diagram\b/);
    const report = await readFile(join(outDir, "doc-validation.md"), "utf8");
    expect(report).toContain("unknown diagram type `flowcart`");
  });

  test("a node left open fails the flow", async () => {
    const { app, outDir } = await cleanApp();
    await writeAt(
      app,
      `${DEFAULT_DOCS_DIR}/concepts/beta.md`,
      [
        "# Beta",
        "",
        "[Alpha](./alpha.md)",
        "",
        "```mermaid",
        "flowchart TD",
        "    A[CLI --> B[Backend]",
        "```",
      ].join("\n"),
    );

    await expect(run(app, outDir)).rejects.toThrow(/1 invalid Mermaid diagram\b/);
    const report = await readFile(join(outDir, "doc-validation.md"), "utf8");
    expect(report).toContain("unclosed brackets");
  });

  test("a diagram the writer never finished fails the flow", async () => {
    const { app, outDir } = await cleanApp();
    await writeAt(
      app,
      `${DEFAULT_DOCS_DIR}/concepts/beta.md`,
      ["# Beta", "", "[Alpha](./alpha.md)", "", "```mermaid", "flowchart TD"].join("\n"),
    );

    await expect(run(app, outDir)).rejects.toThrow(/1 invalid Mermaid diagram\b/);
    const report = await readFile(join(outDir, "doc-validation.md"), "utf8");
    expect(report).toContain("unterminated ```mermaid fence");
  });
});

describe("validate-docs: orphans warn but do not fail", () => {
  test("reports the orphan, warns about it, and still resolves", async () => {
    const { app, outDir } = await cleanApp();
    await writeAt(app, `${DEFAULT_DOCS_DIR}/ARCHITECTURE.md`, "# Architecture");
    const warn = vi.fn();

    const result = await run(app, outDir, warn);
    expect(result.orphans).toBe(1);
    expect(result.broken_links).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      `orphan document: ${DEFAULT_DOCS_DIR}/ARCHITECTURE.md`,
    );

    const report = await readFile(result.report_path, "utf8");
    expect(report).toMatch(
      /## Orphan Documents\s+- `ARCHITECTURE\.md` — no inbound links/,
    );
  });

  test("an INDEX with no inbound links is not an orphan", async () => {
    const { app, outDir } = await cleanApp();
    const result = await run(app, outDir);
    expect(result.orphans).toBe(0);
  });

  test("works without a warn callback", async () => {
    const { app, outDir } = await cleanApp();
    await writeAt(app, `${DEFAULT_DOCS_DIR}/ARCHITECTURE.md`, "# Architecture");
    await expect(run(app, outDir)).resolves.toMatchObject({ orphans: 1 });
  });
});

describe("validate-docs: what is out of scope", () => {
  test("a link to real source outside the corpus is not broken", async () => {
    const { app, outDir } = await cleanApp();
    await writeAt(
      app,
      `${DEFAULT_DOCS_DIR}/concepts/beta.md`,
      "# Beta\n\n[Alpha](./alpha.md) and [cli](../../src/cli.ts).",
    );

    await expect(run(app, outDir)).resolves.toMatchObject({ broken_links: 0 });
  });

  test("quick-update metadata is neither scanned nor reported", async () => {
    const { app, outDir } = await cleanApp();
    await writeAt(
      app,
      `${DEFAULT_DOCS_DIR}/metadata/quick_updates/run-1/summary.md`,
      "# Summary\n\n[gone](./nowhere.md)",
    );

    const result = await run(app, outDir);
    expect(result).toMatchObject({ files_checked: 3, broken_links: 0, orphans: 0 });
  });
});

describe("validate-docs: no corpus", () => {
  test("an absent docs directory is a no-op, not a failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "saaga-vd-"));
    const app = join(root, "app");
    await mkdir(app, { recursive: true });

    await expect(run(app, join(root, "out"))).resolves.toEqual({
      report_path: "",
      files_checked: 0,
      broken_links: 0,
      invalid_diagrams: 0,
      orphans: 0,
      oversized_conventions: 0,
    });
  });

  test("a docs directory holding no documents is a no-op", async () => {
    const root = await mkdtemp(join(tmpdir(), "saaga-vd-"));
    const app = join(root, "app");
    await writeAt(app, `${DEFAULT_DOCS_DIR}/BASELINE`, "# Generated: now");

    await expect(run(app, join(root, "out"))).resolves.toMatchObject({
      files_checked: 0,
      report_path: "",
    });
  });
});

/**
 * The convention cap is the one length rule enforced in code. The verify loop
 * applies the level-of-detail budgets with deliberate tolerance; a convention
 * read with that same tolerance grows back into the pattern it was extracted
 * from, so this one fails the flow instead.
 */
describe("validate-docs: the convention cap", () => {
  /** A conventions category linked from its own INDEX, with a body of `n` lines. */
  async function withConvention(bodyLines: number): Promise<{ app: string; outDir: string }> {
    const { app, outDir } = await cleanApp();
    const docs = `${DEFAULT_DOCS_DIR}/conventions`;
    await writeAt(
      app,
      `${docs}/INDEX.md`,
      [
        "# Conventions Index",
        "",
        "| Name | Description |",
        "|------|-------------|",
        "| [Naming](./naming.md) | what things are called |",
      ].join("\n"),
    );
    await writeAt(
      app,
      `${docs}/naming.md`,
      ["---", "title: Naming", "type: convention", "---", ""]
        .concat(Array.from({ length: bodyLines }, (_, i) => `- rule ${i + 1}`))
        .join("\n"),
    );
    return { app, outDir };
  }

  test("a convention within the cap passes", async () => {
    const { app, outDir } = await withConvention(6);
    await expect(run(app, outDir)).resolves.toMatchObject({
      oversized_conventions: 0,
    });
  });

  test("exactly at the cap passes — it is a ceiling, not a limit to stay under", async () => {
    const { app, outDir } = await withConvention(CONVENTION_MAX_BODY_LINES);
    await expect(run(app, outDir)).resolves.toMatchObject({
      oversized_conventions: 0,
    });
  });

  test("over the cap fails the flow and says what to do about it", async () => {
    const { app, outDir } = await withConvention(CONVENTION_MAX_BODY_LINES + 1);
    await expect(run(app, outDir)).rejects.toThrow(
      /1 over-cap convention document/,
    );

    const report = await readFile(join(outDir, "doc-validation.md"), "utf8");
    expect(report).toMatch(
      /## Over-Cap Convention Documents\s+- `conventions\/naming\.md` — 21 lines of body/,
    );
    expect(report).toContain("split them");
    expect(report).toContain("pattern in disguise");
  });

  test("frontmatter does not count against the body", async () => {
    // A five-line frontmatter block plus a 20-line body is 25 lines on disk and
    // still conforming: the cap governs what a reader has to read.
    const { app, outDir } = await withConvention(CONVENTION_MAX_BODY_LINES);
    const onDisk = await readFile(
      join(app, DEFAULT_DOCS_DIR, "conventions", "naming.md"),
      "utf8",
    );
    expect(onDisk.trimEnd().split("\n").length).toBeGreaterThan(20);
    await expect(run(app, outDir)).resolves.toMatchObject({
      oversized_conventions: 0,
    });
  });

  test("the cap applies to conventions only", async () => {
    // The same 30-line body under concepts/ is a budget question, not a cap
    // violation, and budgets are the verifying agent's job.
    const { app, outDir } = await cleanApp();
    await writeAt(
      app,
      `${DEFAULT_DOCS_DIR}/concepts/beta.md`,
      ["# Beta", "", "See [Alpha](./alpha.md)."]
        .concat(Array.from({ length: 30 }, (_, i) => `- note ${i + 1}`))
        .join("\n"),
    );

    await expect(run(app, outDir)).resolves.toMatchObject({
      oversized_conventions: 0,
    });
  });

  test("a conventions INDEX is exempt", async () => {
    const { app, outDir } = await cleanApp();
    await writeAt(
      app,
      `${DEFAULT_DOCS_DIR}/conventions/INDEX.md`,
      ["# Conventions Index", "", "| Name | Description |", "|------|-------------|"]
        .concat(Array.from({ length: 30 }, (_, i) => `| [R${i}](./r${i}.md) | r |`))
        .join("\n"),
    );

    const result = await run(app, outDir).catch((e: Error) => e);
    // The rows point at documents that do not exist, so this run fails on broken
    // links — but never on the INDEX's own length.
    const report = await readFile(join(outDir, "doc-validation.md"), "utf8");
    expect(report).toContain("Summary: 30 broken links");
    expect(report).toMatch(/## Over-Cap Convention Documents\s+_None_/);
    expect(result).toBeInstanceOf(Error);
  });
});

describe("validate-docs: arg validation", () => {
  test.each([
    ["app_dir", { docs_dir: "d", output_dir: "o" }],
    ["docs_dir", { app_dir: "a", output_dir: "o" }],
    ["output_dir", { app_dir: "a", docs_dir: "d" }],
  ])("requires '%s'", async (name, args) => {
    await expect(
      validateDocs(args as never, { cwd: "/tmp" }),
    ).rejects.toThrow(`validate-docs: '${name}' arg is required`);
  });
});

describe("validate-docs script registration", () => {
  test("is registered in the default script registry", async () => {
    const { defaultScriptRegistry } = await import("../../src/scripts/registry.js");
    expect(defaultScriptRegistry["validate-docs"]).toBeDefined();
  });
});
