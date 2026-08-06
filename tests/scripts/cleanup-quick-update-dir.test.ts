import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { cleanupQuickUpdateDir } from "../../src/scripts/cleanup-quick-update-dir.js";

async function tmpDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `saaga-${prefix}-`));
}

describe("cleanup-quick-update-dir script", () => {
  test("removes the target run-id folder under metadata_root", async () => {
    const metaRoot = await tmpDir("meta");
    const target = join(metaRoot, "run-abc123");
    await mkdir(target);
    await writeFile(join(target, "summary.md"), "x", "utf8");

    await cleanupQuickUpdateDir(
      { metadata_root: metaRoot, run_id: "run-abc123" },
      { cwd: "/x" },
    );

    const remaining = await readdir(metaRoot);
    expect(remaining).toEqual([]);
  });

  test("does not error when the target folder is already gone", async () => {
    const metaRoot = await tmpDir("meta");

    await expect(
      cleanupQuickUpdateDir(
        { metadata_root: metaRoot, run_id: "run-nonexistent" },
        { cwd: "/x" },
      ),
    ).resolves.toBeUndefined();
  });

  test("requires metadata_root arg", async () => {
    await expect(
      cleanupQuickUpdateDir(
        { metadata_root: "", run_id: "run-abc" },
        { cwd: "/x" },
      ),
    ).rejects.toThrow(/metadata_root/);
  });

  test("requires run_id arg", async () => {
    await expect(
      cleanupQuickUpdateDir(
        { metadata_root: "/tmp/meta", run_id: "" },
        { cwd: "/x" },
      ),
    ).rejects.toThrow(/run_id/);
  });

  test("refuses run_id that traverses outside metadata_root", async () => {
    const metaRoot = await tmpDir("meta");
    const sibling = join(metaRoot, "..", "victim");
    await mkdir(sibling, { recursive: true });
    await writeFile(join(sibling, "keep.md"), "z", "utf8");

    await expect(
      cleanupQuickUpdateDir(
        { metadata_root: metaRoot, run_id: "../victim" },
        { cwd: "/x" },
      ),
    ).rejects.toThrow(/outside metadata_root/);

    const remaining = await readdir(sibling);
    expect(remaining).toEqual(["keep.md"]);
  });

  test("refuses an absolute run_id", async () => {
    await expect(
      cleanupQuickUpdateDir(
        { metadata_root: "/tmp/meta", run_id: "/etc/passwd" },
        { cwd: "/x" },
      ),
    ).rejects.toThrow(/outside metadata_root/);
  });
});
