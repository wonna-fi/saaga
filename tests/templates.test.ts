import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  MissingTemplateVariableError,
  renderPrompt,
  renderPromptFile,
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
