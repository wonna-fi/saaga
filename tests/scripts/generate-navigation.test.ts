import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { DEFAULT_DOCS_DIR } from "../../src/cli/config.js";
import { generateNavigation } from "../../src/scripts/generate-navigation.js";
import { validateDocs } from "../../src/scripts/validate-docs.js";

async function writeAt(dir: string, rel: string, content: string): Promise<void> {
  const p = join(dir, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, content, "utf8");
}

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

/**
 * An app whose corpus has an architecture page, two indexed concepts, and one
 * indexed feature — enough for every README section and a real orphan.
 */
async function cleanApp(): Promise<{ app: string; docs: string; outDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "saaga-nav-"));
  const app = join(root, "app");
  const docs = join(app, DEFAULT_DOCS_DIR);

  await writeAt(docs, "ARCHITECTURE.md", "# Architecture — Demo\n");
  await writeAt(
    docs,
    "concepts/INDEX.md",
    index("Concepts", "| [Alpha](./alpha.md) | the first thing |", "| [Beta](./beta.md) | the second thing |"),
  );
  await writeAt(docs, "concepts/alpha.md", "# Alpha\n");
  await writeAt(docs, "concepts/beta.md", "# Beta\n\nSee [Alpha](./alpha.md).\n");
  await writeAt(docs, "features/INDEX.md", index("Features", "| [Doing It](./doing-it.md) | how it gets done |"));
  await writeAt(docs, "features/doing-it.md", "# Doing It\n");

  return { app, docs, outDir: join(root, "out") };
}

function run(app: string, warn?: (m: string) => void) {
  return generateNavigation(
    { app_dir: app, docs_dir: DEFAULT_DOCS_DIR, app: "demo" },
    { cwd: app, warn },
  );
}

function validate(app: string, outDir: string) {
  return validateDocs(
    { app_dir: app, docs_dir: DEFAULT_DOCS_DIR, output_dir: outDir },
    { cwd: app },
  );
}

const readGenerated = async (docs: string) => ({
  readme: await readFile(join(docs, "README.md"), "utf8"),
  glossary: await readFile(join(docs, "GLOSSARY.md"), "utf8"),
});

describe("generate-navigation: a small corpus", () => {
  test("writes README.md and GLOSSARY.md into the docs root", async () => {
    const { app, docs } = await cleanApp();
    const result = await run(app);

    expect(result.readme_path).toBe(join(docs, "README.md"));
    expect(result.glossary_path).toBe(join(docs, "GLOSSARY.md"));

    const { readme, glossary } = await readGenerated(docs);
    expect(readme).toContain("# demo Documentation");
    expect(glossary).toContain("# Glossary");
  });

  test("returns counters describing what it built", async () => {
    const { app } = await cleanApp();

    expect(await run(app)).toMatchObject({
      indexes: 2,
      rows: 3,
      terms: 3,
      collisions: 0,
      core_concepts: 2,
      problems: 0,
    });
  });

  test("does not warn when there is nothing to warn about", async () => {
    const { app } = await cleanApp();
    const warn = vi.fn();

    await run(app, warn);

    expect(warn).not.toHaveBeenCalled();
  });

  test("copies each definition verbatim from its index row", async () => {
    const { app, docs } = await cleanApp();
    await run(app);

    expect((await readGenerated(docs)).glossary).toContain(
      "- [Alpha](./concepts/alpha.md) — the first thing",
    );
  });
});

describe("generate-navigation: idempotence", () => {
  test("a second run on unchanged input produces a zero diff", async () => {
    const { app, docs } = await cleanApp();

    await run(app);
    const first = await readGenerated(docs);
    await run(app);
    const second = await readGenerated(docs);

    expect(second).toEqual(first);
  });

  test("a third run is also unchanged", async () => {
    const { app, docs } = await cleanApp();

    await run(app);
    await run(app);
    const second = await readGenerated(docs);
    await run(app);

    expect(await readGenerated(docs)).toEqual(second);
  });
});

describe("generate-navigation: the corpus it produces validates", () => {
  test("de-orphans ARCHITECTURE.md", async () => {
    const { app, outDir } = await cleanApp();

    // The orphan is real before the navigation layer exists — otherwise this
    // test would pass without the generator doing anything.
    expect(await validate(app, outDir)).toMatchObject({ orphans: 1 });

    await run(app);

    expect(await validate(app, outDir)).toMatchObject({ orphans: 0, broken_links: 0 });
  });

  test("never emits a link to a document that does not exist", async () => {
    const { app, docs, outDir } = await cleanApp();
    await rm(join(docs, "concepts/beta.md"));
    const warn = vi.fn();

    await run(app, warn);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("index row target `./beta.md` does not exist"),
    );

    const { readme, glossary } = await readGenerated(docs);
    expect(readme).not.toContain("beta.md");
    expect(glossary).not.toContain("beta.md");

    // The stale row in the INDEX is a real broken link and validate-docs
    // fails on it — as it should. What matters is that the generator did not
    // copy that row and multiply one INDEX defect into three.
    await expect(validate(app, outDir)).rejects.toThrow("1 broken link");
    const report = await readFile(join(outDir, "doc-validation.md"), "utf8");
    expect(report).toContain("`concepts/INDEX.md:6`");
  });
});

describe("generate-navigation: defects warn but never fail", () => {
  test("warns and omits the architecture section when ARCHITECTURE.md is missing", async () => {
    const { app, docs } = await cleanApp();
    await rm(join(docs, "ARCHITECTURE.md"));
    const warn = vi.fn();

    await run(app, warn);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no ARCHITECTURE.md in the corpus"));
    expect((await readGenerated(docs)).readme).not.toContain("## Architecture");
  });

  test("warns and omits a malformed index row", async () => {
    const { app, docs } = await cleanApp();
    await writeAt(
      docs,
      "concepts/INDEX.md",
      index("Concepts", "| [Alpha](./alpha.md) | the first thing |", "| [Beta](./beta.md | broken |"),
    );
    const warn = vi.fn();

    const result = await run(app, warn);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`${DEFAULT_DOCS_DIR}/concepts/INDEX.md:6 — unparseable index row`),
    );
    expect(result.rows).toBe(2);
  });

  test("warns and omits a term whose document has no index row", async () => {
    const { app, docs } = await cleanApp();
    await writeAt(
      docs,
      "ARCHITECTURE.md",
      "---\ntitle: Architecture\ntype: architecture\nterms:\n  - shape\n---\n\n# Architecture — Demo\n",
    );
    const warn = vi.fn();

    await run(app, warn);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('declares term "shape"'));
    expect((await readGenerated(docs)).glossary).not.toContain("shape");
  });

  test("renders declared terms with two homes as a see-also entry", async () => {
    const { app, docs } = await cleanApp();
    await writeAt(docs, "concepts/alpha.md", "---\ntitle: Alpha\ntype: concept\nterms:\n  - phase\n---\n\n# Alpha\n");
    await writeAt(
      docs,
      "features/doing-it.md",
      "---\ntitle: Doing It\ntype: feature\nterms:\n  - phase\n---\n\n# Doing It\n",
    );

    const result = await run(app);
    const { glossary } = await readGenerated(docs);

    expect(result).toMatchObject({ terms: 4, collisions: 1 });
    expect(glossary).toContain("- phase — see also:");
    expect(glossary).toContain("  - [Alpha](./concepts/alpha.md) — the first thing");
    expect(glossary).toContain("  - [Doing It](./features/doing-it.md) — how it gets done");
  });

  test("caps warnings at ten and says how many more there are", async () => {
    const { app, docs } = await cleanApp();
    const broken = Array.from({ length: 12 }, (_, i) => `| [Row ${i}](./row-${i}.md | broken |`);
    await writeAt(docs, "concepts/INDEX.md", index("Concepts", ...broken));
    const warn = vi.fn();

    await run(app, warn);

    expect(warn).toHaveBeenCalledTimes(11);
    expect(warn).toHaveBeenLastCalledWith("…and 2 more navigation problem(s)");
  });

  test("works without a warn callback", async () => {
    const { app, docs } = await cleanApp();
    await rm(join(docs, "ARCHITECTURE.md"));

    await expect(
      generateNavigation({ app_dir: app, docs_dir: DEFAULT_DOCS_DIR, app: "demo" }, { cwd: app }),
    ).resolves.toMatchObject({ problems: 1 });
  });
});

describe("generate-navigation: no corpus", () => {
  test("an absent docs directory is a no-op, not a failure", async () => {
    const app = await mkdtemp(join(tmpdir(), "saaga-nav-"));

    expect(await run(app)).toMatchObject({ readme_path: "", glossary_path: "", rows: 0 });
  });

  test("a docs directory with no INDEX writes nothing and warns", async () => {
    const root = await mkdtemp(join(tmpdir(), "saaga-nav-"));
    const app = join(root, "app");
    await writeAt(join(app, DEFAULT_DOCS_DIR), "ARCHITECTURE.md", "# Architecture\n");
    const warn = vi.fn();

    const result = await run(app, warn);

    expect(result).toMatchObject({ readme_path: "", glossary_path: "" });
    expect(warn).toHaveBeenCalledWith(
      `no INDEX.md under ${DEFAULT_DOCS_DIR}/; navigation not generated`,
    );
  });
});

describe("generate-navigation: arg validation", () => {
  test.each([
    ["app_dir", { docs_dir: "d", app: "a" }],
    ["docs_dir", { app_dir: "a", app: "a" }],
    ["app", { app_dir: "a", docs_dir: "d" }],
  ])("requires '%s'", async (name, args) => {
    await expect(generateNavigation(args as never, { cwd: "/tmp" })).rejects.toThrow(
      `generate-navigation: '${name}' arg is required`,
    );
  });
});

describe("generate-navigation script registration", () => {
  test("is registered in the default script registry", async () => {
    const { defaultScriptRegistry } = await import("../../src/scripts/registry.js");

    expect(defaultScriptRegistry["generate-navigation"]).toBeDefined();
  });
});
