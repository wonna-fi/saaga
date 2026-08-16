import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  SAAGA_RULES_FILE,
  SaagaRulesError,
  appendSaagaRules,
  loadSaagaRules,
} from "../src/saaga-rules.js";

describe("loadSaagaRules", () => {
  test("returns undefined when file does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-rules-"));
    expect(await loadSaagaRules(dir)).toBeUndefined();
  });

  test("returns undefined when file is empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-rules-"));
    await writeFile(join(dir, SAAGA_RULES_FILE), "", "utf8");
    expect(await loadSaagaRules(dir)).toBeUndefined();
  });

  test("returns undefined when file contains only whitespace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-rules-"));
    await writeFile(join(dir, SAAGA_RULES_FILE), "   \n\t\n  ", "utf8");
    expect(await loadSaagaRules(dir)).toBeUndefined();
  });

  test("returns trimmed content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-rules-"));
    await writeFile(
      join(dir, SAAGA_RULES_FILE),
      "\n  Focus on API boundaries.\n\n",
      "utf8",
    );
    expect(await loadSaagaRules(dir)).toBe("Focus on API boundaries.");
  });

  test("preserves internal whitespace and structure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-rules-"));
    const content = "Line one.\n\n  Indented line.\nLast line.";
    await writeFile(join(dir, SAAGA_RULES_FILE), `\n${content}\n`, "utf8");
    expect(await loadSaagaRules(dir)).toBe(content);
  });

  test("does not interpolate {var} placeholders", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-rules-"));
    await writeFile(
      join(dir, SAAGA_RULES_FILE),
      "Document {ServiceOrModule} in detail.",
      "utf8",
    );
    expect(await loadSaagaRules(dir)).toBe(
      "Document {ServiceOrModule} in detail.",
    );
  });

  test("rejects files exceeding 64 KiB", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-rules-"));
    const big = Buffer.alloc(64 * 1024 + 1, 0x41);
    await writeFile(join(dir, SAAGA_RULES_FILE), big);
    await expect(loadSaagaRules(dir)).rejects.toThrow(SaagaRulesError);
    await expect(loadSaagaRules(dir)).rejects.toThrow("64 KiB");
  });

  test("accepts files exactly at 64 KiB", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-rules-"));
    const exact = Buffer.alloc(64 * 1024, 0x41);
    await writeFile(join(dir, SAAGA_RULES_FILE), exact);
    const result = await loadSaagaRules(dir);
    expect(result).toBeDefined();
    expect(result!.length).toBe(64 * 1024);
  });

  test("rejects invalid UTF-8", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-rules-"));
    const invalid = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0xff, 0xfe]);
    await writeFile(join(dir, SAAGA_RULES_FILE), invalid);
    await expect(loadSaagaRules(dir)).rejects.toThrow(SaagaRulesError);
    await expect(loadSaagaRules(dir)).rejects.toThrow("invalid UTF-8");
  });

  test("throws SaagaRulesError on permission/read errors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-rules-"));
    const filePath = join(dir, SAAGA_RULES_FILE);
    await mkdir(filePath);
    await expect(loadSaagaRules(dir)).rejects.toThrow(SaagaRulesError);
  });
});

describe("appendSaagaRules", () => {
  const basePrompt = "# Document the Architecture\n\nDo things.";

  test("returns prompt unchanged when rules are undefined", () => {
    expect(appendSaagaRules(basePrompt, undefined)).toBe(basePrompt);
  });

  test("returns prompt unchanged when rules are empty string", () => {
    expect(appendSaagaRules(basePrompt, "")).toBe(basePrompt);
  });

  test("appends rules block with bounded-priority wrapper", () => {
    const result = appendSaagaRules(basePrompt, "Focus on APIs.");
    expect(result).toContain(basePrompt);
    expect(result).toContain("---");
    expect(result).toContain(".saagarules");
    expect(result).toContain("HIGH PRIORITY");
    expect(result).toContain("do not override");
    expect(result).toContain("Focus on APIs.");
  });

  test("preserves original prompt at the start", () => {
    const result = appendSaagaRules(basePrompt, "Extra context.");
    expect(result.startsWith(basePrompt)).toBe(true);
  });

  test("rules appear after the separator", () => {
    const result = appendSaagaRules(basePrompt, "My rules here.");
    const separatorIdx = result.indexOf("---");
    const rulesIdx = result.indexOf("My rules here.");
    expect(separatorIdx).toBeGreaterThan(0);
    expect(rulesIdx).toBeGreaterThan(separatorIdx);
  });
});
