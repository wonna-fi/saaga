import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { archiveQuickUpdate } from "../../src/scripts/archive-quick-update.js";

async function tmpDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `saaga-${prefix}-`));
}

describe("archive-quick-update script", () => {
  test("copies changes.md into dest_dir", async () => {
    const src = await tmpDir("src");
    const dest = await tmpDir("dest");
    const changesPath = join(src, "changes.md");
    await writeFile(changesPath, "# Changes\n\nSome changes.", "utf8");
    const destDir = join(dest, "run-123");

    await archiveQuickUpdate(
      { changes_path: changesPath, dest_dir: destDir },
      { cwd: "/x" },
    );

    const copied = await readFile(join(destDir, "changes.md"), "utf8");
    expect(copied).toBe("# Changes\n\nSome changes.");
  });

  test("creates dest_dir recursively if it does not exist", async () => {
    const src = await tmpDir("src");
    const dest = await tmpDir("dest");
    const changesPath = join(src, "changes.md");
    await writeFile(changesPath, "content", "utf8");
    const deepDest = join(dest, "a", "b", "c");

    await archiveQuickUpdate(
      { changes_path: changesPath, dest_dir: deepDest },
      { cwd: "/x" },
    );

    const copied = await readFile(join(deepDest, "changes.md"), "utf8");
    expect(copied).toBe("content");
  });

  test("requires changes_path arg", async () => {
    await expect(
      archiveQuickUpdate(
        { changes_path: "", dest_dir: "/tmp/x" },
        { cwd: "/x" },
      ),
    ).rejects.toThrow(/changes_path/);
  });

  test("requires dest_dir arg", async () => {
    await expect(
      archiveQuickUpdate(
        { changes_path: "/tmp/changes.md", dest_dir: "" },
        { cwd: "/x" },
      ),
    ).rejects.toThrow(/dest_dir/);
  });

  test("throws when summary_path is given but the summary is missing", async () => {
    const src = await tmpDir("src");
    const dest = await tmpDir("dest");
    const changesPath = join(src, "changes.md");
    await writeFile(changesPath, "content", "utf8");
    const destDir = join(dest, "run-missing-summary");

    await expect(
      archiveQuickUpdate(
        {
          changes_path: changesPath,
          dest_dir: destDir,
          summary_path: join(destDir, "summary.md"),
        },
        { cwd: "/x" },
      ),
    ).rejects.toThrow(/summary/);

    await expect(readFile(join(destDir, "changes.md"), "utf8")).rejects.toThrow();
  });

  test("archives when summary_path exists", async () => {
    const src = await tmpDir("src");
    const dest = await tmpDir("dest");
    const changesPath = join(src, "changes.md");
    await writeFile(changesPath, "content", "utf8");
    const destDir = join(dest, "run-with-summary");
    const summaryPath = join(destDir, "summary.md");
    await mkdir(destDir, { recursive: true });
    await writeFile(summaryPath, "# Summary", "utf8");

    await archiveQuickUpdate(
      { changes_path: changesPath, dest_dir: destDir, summary_path: summaryPath },
      { cwd: "/x" },
    );

    const copied = await readFile(join(destDir, "changes.md"), "utf8");
    expect(copied).toBe("content");
  });
});
