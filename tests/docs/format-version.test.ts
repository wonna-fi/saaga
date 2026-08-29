import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  CURRENT_FORMAT_VERSION,
  FORMAT_FILE,
  readFormatVersion,
  writeFormatVersion,
} from "../../src/docs/format-version.js";

async function tmpDocsDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "saaga-fv-"));
  return join(root, "saaga-docs");
}

describe("readFormatVersion", () => {
  test("an absent docs directory is no corpus", async () => {
    const docs = await tmpDocsDir();

    expect(await readFormatVersion(docs)).toEqual({ state: "no-corpus" });
  });

  test("an empty docs directory is no corpus, not version 0", async () => {
    const docs = await tmpDocsDir();
    await mkdir(docs, { recursive: true });

    expect(await readFormatVersion(docs)).toEqual({ state: "no-corpus" });
  });

  test("a populated docs directory without the stamp is version 0", async () => {
    const docs = await tmpDocsDir();
    await mkdir(docs, { recursive: true });
    await writeFile(join(docs, "ARCHITECTURE.md"), "# Arch\n", "utf8");

    expect(await readFormatVersion(docs)).toEqual({
      state: "corpus",
      version: 0,
    });
  });

  test("reads the stamped version", async () => {
    const docs = await tmpDocsDir();
    await mkdir(docs, { recursive: true });
    await writeFile(join(docs, FORMAT_FILE), "format_version: 7\n", "utf8");

    expect(await readFormatVersion(docs)).toEqual({
      state: "corpus",
      version: 7,
    });
  });

  test("throws a descriptive error on malformed YAML", async () => {
    const docs = await tmpDocsDir();
    await mkdir(docs, { recursive: true });
    await writeFile(join(docs, FORMAT_FILE), "format_version: [1\n", "utf8");

    await expect(readFormatVersion(docs)).rejects.toThrow(/invalid YAML/);
  });

  test("throws when the version is missing or not an integer", async () => {
    const docs = await tmpDocsDir();
    await mkdir(docs, { recursive: true });

    await writeFile(join(docs, FORMAT_FILE), "something_else: 1\n", "utf8");
    await expect(readFormatVersion(docs)).rejects.toThrow(/format_version/);

    await writeFile(join(docs, FORMAT_FILE), "format_version: one\n", "utf8");
    await expect(readFormatVersion(docs)).rejects.toThrow(/format_version/);
  });
});

describe("writeFormatVersion", () => {
  test("stamps the current version, creating the directory", async () => {
    const docs = await tmpDocsDir();

    await writeFormatVersion(docs);

    const content = await readFile(join(docs, FORMAT_FILE), "utf8");
    expect(content).toBe(`format_version: ${CURRENT_FORMAT_VERSION}\n`);
  });

  test("what it writes reads back as a matching corpus", async () => {
    const docs = await tmpDocsDir();

    await writeFormatVersion(docs);

    expect(await readFormatVersion(docs)).toEqual({
      state: "corpus",
      version: CURRENT_FORMAT_VERSION,
    });
  });

  test("is idempotent", async () => {
    const docs = await tmpDocsDir();

    await writeFormatVersion(docs);
    const first = await readFile(join(docs, FORMAT_FILE), "utf8");
    await writeFormatVersion(docs);

    expect(await readFile(join(docs, FORMAT_FILE), "utf8")).toBe(first);
  });
});
