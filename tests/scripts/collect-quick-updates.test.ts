import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { collectQuickUpdates } from "../../src/scripts/collect-quick-updates.js";

async function tmpDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `saaga-${prefix}-`));
}

describe("collect-quick-updates script", () => {
  test("returns count=0 when metadata_dir does not exist", async () => {
    const output = await tmpDir("out");
    const result = await collectQuickUpdates(
      { metadata_dir: join(output, "nonexistent"), output_dir: output },
      { cwd: "/x" },
    );
    expect(result.count).toBe(0);
    expect(result.ids).toEqual([]);
  });

  test("returns count=0 when metadata_dir is empty", async () => {
    const metaDir = await tmpDir("meta");
    const output = await tmpDir("out");
    const result = await collectQuickUpdates(
      { metadata_dir: metaDir, output_dir: output },
      { cwd: "/x" },
    );
    expect(result.count).toBe(0);
    expect(result.ids).toEqual([]);
  });

  test("captures artifact folders sorted alphabetically", async () => {
    const metaDir = await tmpDir("meta");
    await mkdir(join(metaDir, "run-b"));
    await mkdir(join(metaDir, "run-a"));
    await mkdir(join(metaDir, "run-c"));
    // Also add a regular file that should be ignored
    await writeFile(join(metaDir, "stray-file.txt"), "x", "utf8");

    const output = await tmpDir("out");
    const result = await collectQuickUpdates(
      { metadata_dir: metaDir, output_dir: output },
      { cwd: "/x" },
    );

    expect(result.count).toBe(3);
    expect(result.ids).toEqual(["run-a", "run-b", "run-c"]);
    expect(result.manifest_path).toBe(
      join(output, "quick-updates-manifest.json"),
    );

    const manifest = JSON.parse(
      await readFile(result.manifest_path, "utf8"),
    ) as { metadata_dir: string; ids: string[] };
    expect(manifest.metadata_dir).toBe(metaDir);
    expect(manifest.ids).toEqual(["run-a", "run-b", "run-c"]);
  });

  test("requires metadata_dir arg", async () => {
    await expect(
      collectQuickUpdates(
        { metadata_dir: "", output_dir: "/tmp/x" },
        { cwd: "/x" },
      ),
    ).rejects.toThrow(/metadata_dir/);
  });

  test("requires output_dir arg", async () => {
    await expect(
      collectQuickUpdates(
        { metadata_dir: "/tmp/x", output_dir: "" },
        { cwd: "/x" },
      ),
    ).rejects.toThrow(/output_dir/);
  });
});
