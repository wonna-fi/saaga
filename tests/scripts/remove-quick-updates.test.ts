import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { removeQuickUpdates } from "../../src/scripts/remove-quick-updates.js";

async function tmpDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `saaga-${prefix}-`));
}

describe("remove-quick-updates script", () => {
  test("deletes exactly the folders listed in the manifest", async () => {
    const metaDir = await tmpDir("meta");
    await mkdir(join(metaDir, "run-a"));
    await writeFile(join(metaDir, "run-a", "changes.md"), "x", "utf8");
    await mkdir(join(metaDir, "run-b"));
    await writeFile(join(metaDir, "run-b", "changes.md"), "y", "utf8");
    await mkdir(join(metaDir, "run-c"));

    const runDir = await tmpDir("run");
    const manifestPath = join(runDir, "manifest.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        metadata_dir: metaDir,
        ids: ["run-a", "run-b"],
      }),
      "utf8",
    );

    await removeQuickUpdates({ manifest: manifestPath }, { cwd: "/x" });

    const remaining = await readdir(metaDir);
    expect(remaining).toEqual(["run-c"]);
  });

  test("does not error when a listed folder is already gone", async () => {
    const metaDir = await tmpDir("meta");
    await mkdir(join(metaDir, "run-a"));

    const runDir = await tmpDir("run");
    const manifestPath = join(runDir, "manifest.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        metadata_dir: metaDir,
        ids: ["run-a", "run-nonexistent"],
      }),
      "utf8",
    );

    await expect(
      removeQuickUpdates({ manifest: manifestPath }, { cwd: "/x" }),
    ).resolves.toBeUndefined();

    const remaining = await readdir(metaDir);
    expect(remaining).toEqual([]);
  });

  test("requires manifest arg", async () => {
    await expect(
      removeQuickUpdates({ manifest: "" }, { cwd: "/x" }),
    ).rejects.toThrow(/manifest/);
  });

  test("refuses ids that escape the metadata_dir", async () => {
    const metaDir = await tmpDir("meta");
    await mkdir(join(metaDir, "quick"));
    const sibling = join(metaDir, "outside-victim");
    await mkdir(sibling);
    await writeFile(join(sibling, "keep.md"), "z", "utf8");

    const runDir = await tmpDir("run");
    const manifestPath = join(runDir, "manifest.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        metadata_dir: join(metaDir, "quick"),
        ids: ["../outside-victim"],
      }),
      "utf8",
    );

    await expect(
      removeQuickUpdates({ manifest: manifestPath }, { cwd: "/x" }),
    ).rejects.toThrow(/outside metadata_dir/);

    const remaining = await readdir(sibling);
    expect(remaining).toEqual(["keep.md"]);
  });

  test("throws on invalid manifest content", async () => {
    const runDir = await tmpDir("run");
    const manifestPath = join(runDir, "bad-manifest.json");
    await writeFile(manifestPath, JSON.stringify({ wrong: true }), "utf8");

    await expect(
      removeQuickUpdates({ manifest: manifestPath }, { cwd: "/x" }),
    ).rejects.toThrow(/invalid manifest/);
  });
});
