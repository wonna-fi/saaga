import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  CircularIncludeError,
  IncludeOutsideRootError,
  MissingTemplateVariableError,
  renderPrompt,
  renderPromptFile,
  TemplateFileNotFoundError,
} from "../src/templates.js";

describe("renderPrompt", () => {
  test("substitutes a single {key} placeholder", () => {
    const out = renderPrompt("Hello {name}", { name: "World" });
    expect(out).toBe("Hello World");
  });

  test("substitutes multiple distinct placeholders", () => {
    const out = renderPrompt("App: {app}; Out: {output_path}", {
      app: "salesforce",
      output_path: "/runs/x/plan.md",
    });
    expect(out).toBe("App: salesforce; Out: /runs/x/plan.md");
  });

  test("substitutes the same key when it appears multiple times", () => {
    const out = renderPrompt("{x} and {x} and again {x}", { x: "yes" });
    expect(out).toBe("yes and yes and again yes");
  });

  test("leaves unmatched placeholders intact (parity with bash render_prompt)", () => {
    const out = renderPrompt("Hello {name}, see {Type}", { name: "World" });
    expect(out).toBe("Hello World, see {Type}");
  });

  test("strict mode throws on missing variables", () => {
    expect(() =>
      renderPrompt("Hello {name}, see {plan}", { name: "World" }, { strict: true }),
    ).toThrowError(MissingTemplateVariableError);
  });

  test("strict-mode error names the missing key", () => {
    try {
      renderPrompt("see {plan}", {}, { strict: true });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MissingTemplateVariableError);
      expect((err as Error).message).toContain("plan");
    }
  });

  test("ignores extra variables that are not referenced in the template", () => {
    const out = renderPrompt("Hi {name}", {
      name: "Ada",
      unused: "something",
    });
    expect(out).toBe("Hi Ada");
  });

  test("does not interpret regex metacharacters in values", () => {
    const out = renderPrompt("path={p}", { p: "$1.\\foo[bar]" });
    expect(out).toBe("path=$1.\\foo[bar]");
  });
});

describe("renderPromptFile", () => {
  test("reads the file and substitutes variables", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-tpl-"));
    const file = join(dir, "tpl.md");
    await writeFile(file, "App: {app}\nOut: {output_path}\n", "utf8");

    const out = await renderPromptFile(file, {
      app: "salesforce",
      output_path: "/runs/x/plan.md",
    });
    expect(out).toBe("App: salesforce\nOut: /runs/x/plan.md\n");
  });

  test("throws a clear error when the template file does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-tpl-"));
    const file = join(dir, "missing.md");

    await expect(renderPromptFile(file, {})).rejects.toThrow(
      /Prompt template not found/,
    );
  });

  test("propagates strict-mode missing-variable errors from the underlying template", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-tpl-"));
    const file = join(dir, "tpl.md");
    await writeFile(file, "Hello {name}", "utf8");

    await expect(
      renderPromptFile(file, {}, { strict: true }),
    ).rejects.toBeInstanceOf(MissingTemplateVariableError);
  });
});

describe("includes", () => {
  async function fixture(
    files: Record<string, string>,
  ): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "saaga-inc-"));
    for (const [rel, content] of Object.entries(files)) {
      const path = join(dir, rel);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
    }
    return dir;
  }

  test("expands a single include", async () => {
    const dir = await fixture({
      "main.md": "before\n{include:partials/body.md}\nafter\n",
      "partials/body.md": "BODY\n",
    });

    const out = await renderPromptFile(join(dir, "main.md"), {});
    expect(out).toBe("before\nBODY\nafter\n");
  });

  test("expands nested includes", async () => {
    const dir = await fixture({
      "main.md": "{include:partials/all.md}\n",
      "partials/all.md": "{include:partials/one.md}\n{include:partials/two.md}\n",
      "partials/one.md": "ONE\n",
      "partials/two.md": "TWO\n",
    });

    const out = await renderPromptFile(join(dir, "main.md"), {});
    expect(out).toBe("ONE\nTWO\n");
  });

  test("substitutes placeholders that live inside a partial", async () => {
    const dir = await fixture({
      "main.md": "{include:partials/body.md}\n",
      "partials/body.md": "Docs live in {docs_dir}/concepts\n",
    });

    const out = await renderPromptFile(join(dir, "main.md"), {
      docs_dir: "saaga-docs",
    });
    expect(out).toBe("Docs live in saaga-docs/concepts\n");
  });

  test("leaves literal template tokens inside a partial intact", async () => {
    const dir = await fixture({
      "main.md": "{include:partials/body.md}\n",
      "partials/body.md": "# {Type} Index\n",
    });

    const out = await renderPromptFile(join(dir, "main.md"), {});
    expect(out).toBe("# {Type} Index\n");
  });

  test("does not expand an include that arrives via a variable value", async () => {
    const dir = await fixture({
      "main.md": "{body}\n",
      "partials/secret.md": "SECRET\n",
    });

    const out = await renderPromptFile(join(dir, "main.md"), {
      body: "{include:partials/secret.md}",
    });
    expect(out).toBe("{include:partials/secret.md}\n");
    expect(out).not.toContain("SECRET");
  });

  test("allows the same partial to be included more than once", async () => {
    const dir = await fixture({
      "main.md": "{include:partials/body.md}\n{include:partials/body.md}\n",
      "partials/body.md": "BODY\n",
    });

    const out = await renderPromptFile(join(dir, "main.md"), {});
    expect(out).toBe("BODY\nBODY\n");
  });

  test("resolves against the including file's directory before the roots", async () => {
    const selfDir = await fixture({
      "main.md": "{include:shared.md}\n",
      "shared.md": "LOCAL\n",
    });
    const rootDir = await fixture({ "shared.md": "SHARED\n" });

    const out = await renderPromptFile(join(selfDir, "main.md"), {}, {
      includeRoots: [rootDir],
    });
    expect(out).toBe("LOCAL\n");
  });

  test("falls through to a configured root when the local file is absent", async () => {
    const selfDir = await fixture({ "main.md": "{include:shared.md}\n" });
    const rootDir = await fixture({ "shared.md": "SHARED\n" });

    const out = await renderPromptFile(join(selfDir, "main.md"), {}, {
      includeRoots: [rootDir],
    });
    expect(out).toBe("SHARED\n");
  });

  test("walks the roots in order and stops at the first hit", async () => {
    const selfDir = await fixture({ "main.md": "{include:shared.md}\n" });
    const firstRoot = await fixture({ "shared.md": "FIRST\n" });
    const secondRoot = await fixture({ "shared.md": "SECOND\n" });

    const out = await renderPromptFile(join(selfDir, "main.md"), {}, {
      includeRoots: [firstRoot, secondRoot],
    });
    expect(out).toBe("FIRST\n");
  });

  test("resolves a nested include against the roots, not just its own directory", async () => {
    const selfDir = await fixture({ "main.md": "{include:outer.md}\n" });
    const rootDir = await fixture({
      "outer.md": "{include:inner.md}\n",
      "inner.md": "INNER\n",
    });

    const out = await renderPromptFile(join(selfDir, "main.md"), {}, {
      includeRoots: [rootDir],
    });
    expect(out).toBe("INNER\n");
  });

  test("defaults the search path to the template's own directory", async () => {
    const dir = await fixture({
      "main.md": "{include:partials/body.md}\n",
      "partials/body.md": "BODY\n",
    });

    const out = await renderPromptFile(join(dir, "main.md"), {});
    expect(out).toBe("BODY\n");
  });

  test("throws when the partial does not exist, naming the roots tried", async () => {
    const selfDir = await fixture({ "main.md": "{include:missing.md}\n" });
    const rootDir = await fixture({});

    await expect(
      renderPromptFile(join(selfDir, "main.md"), {}, { includeRoots: [rootDir] }),
    ).rejects.toBeInstanceOf(TemplateFileNotFoundError);

    await expect(
      renderPromptFile(join(selfDir, "main.md"), {}, { includeRoots: [rootDir] }),
    ).rejects.toThrow(new RegExp(rootDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  test("rejects an include that climbs out of every root", async () => {
    const dir = await fixture({ "main.md": "{include:../escape.md}\n" });
    await writeFile(join(dir, "..", "escape.md"), "ESCAPED\n", "utf8");

    await expect(
      renderPromptFile(join(dir, "main.md"), {}),
    ).rejects.toBeInstanceOf(IncludeOutsideRootError);
  });

  test("rejects an absolute include path", async () => {
    const dir = await fixture({ "main.md": "{include:/etc/passwd}\n" });

    await expect(
      renderPromptFile(join(dir, "main.md"), {}),
    ).rejects.toBeInstanceOf(IncludeOutsideRootError);
  });

  test("detects a direct cycle", async () => {
    const dir = await fixture({
      "main.md": "{include:a.md}\n",
      "a.md": "{include:a.md}\n",
    });

    await expect(
      renderPromptFile(join(dir, "main.md"), {}),
    ).rejects.toBeInstanceOf(CircularIncludeError);
  });

  test("detects an indirect cycle", async () => {
    const dir = await fixture({
      "main.md": "{include:a.md}\n",
      "a.md": "{include:b.md}\n",
      "b.md": "{include:a.md}\n",
    });

    await expect(
      renderPromptFile(join(dir, "main.md"), {}),
    ).rejects.toThrow(/Circular include/);
  });

  test("renderPrompt leaves include directives untouched", () => {
    const out = renderPrompt("{include:partials/body.md} and {name}", {
      name: "Ada",
    });
    expect(out).toBe("{include:partials/body.md} and Ada");
  });
});
