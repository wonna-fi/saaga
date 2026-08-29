import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { countDocsReads } from "./src/runner.js";
import { stripAnsi } from "./src/checks.js";

/**
 * Regression tests for two measurement defects found while reading the
 * v2 haiku baseline: docsReads counted read *attempts* (breaking the
 * no-docs negative control when a weak model guessed a corpus path that
 * does not exist), and checkDetail carried raw ANSI escapes.
 */

async function transcript(lines: unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "saaga-eval-fx-"));
  const file = join(dir, "run.ndjson");
  await writeFile(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
}

function toolUse(id: string, path: string): unknown {
  return {
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name: "Read", input: { file_path: path } }] },
  };
}

function toolResult(id: string, isError: boolean): unknown {
  return {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: id,
          is_error: isError,
          content: isError ? "File does not exist." : "# doc",
        },
      ],
    },
  };
}

describe("countDocsReads", () => {
  test("counts corpus reads that succeeded", async () => {
    const file = await transcript([
      toolUse("a", "/tmp/sbx/saaga-docs/concepts/scope.md"),
      toolResult("a", false),
      toolUse("b", "/tmp/sbx/saaga-docs/patterns/INDEX.md"),
      toolResult("b", false),
    ]);
    expect(await countDocsReads(file)).toBe(2);
  });

  test("does not count a failed read attempt (the no-docs negative control)", async () => {
    const file = await transcript([
      toolUse("a", "/tmp/sbx/saaga-docs/concepts/scope.md"),
      toolResult("a", true),
      toolUse("b", "/tmp/sbx/src/agent/audit.ts"),
      toolResult("b", false),
    ]);
    expect(await countDocsReads(file)).toBe(0);
  });

  test("survives non-JSON noise and string message payloads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-eval-fx-"));
    const file = join(dir, "run.ndjson");
    const lines = [
      "not json at all",
      JSON.stringify({ type: "system", message: "plain string" }),
      JSON.stringify(toolUse("a", "/s/saaga-docs/x.md")),
      JSON.stringify(toolResult("a", false)),
    ];
    await writeFile(file, lines.join("\n"));
    expect(await countDocsReads(file)).toBe(1);
  });

  test("undefined when no transcript exists (fake-agent runs)", async () => {
    expect(await countDocsReads("/nonexistent/run.ndjson")).toBeUndefined();
  });
});

describe("stripAnsi", () => {
  test("removes the color escapes vitest emits even under FORCE_COLOR=0", () => {
    const esc = String.fromCharCode(27);
    const raw = `Tests ${esc}[1m${esc}[31m1 failed${esc}[39m${esc}[22m | ${esc}[32m14 passed${esc}[39m (15)`;
    expect(stripAnsi(raw)).toBe("Tests 1 failed | 14 passed (15)");
  });
});
