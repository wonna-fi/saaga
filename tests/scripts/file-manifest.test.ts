import { mkdir, mkdtemp, readlink, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  computeManifest,
  gitBlobHash,
} from "../../src/scripts/file-manifest.js";

async function writeAt(dir: string, relpath: string, content: string): Promise<void> {
  const p = join(dir, relpath);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, content, "utf8");
}

function paths(entries: { path: string }[]): string[] {
  return entries.map((e) => e.path).sort();
}

describe("computeManifest — root-only ignore (regression)", () => {
  test("root .gitignore excludes matching files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "manifest-"));
    await writeAt(dir, ".gitignore", "dist/\n");
    await writeAt(dir, "src/foo.ts", "x");
    await writeAt(dir, "dist/bundle.js", "y");

    const result = paths(await computeManifest(dir));
    expect(result).toContain("src/foo.ts");
    expect(result).toContain(".gitignore");
    expect(result).not.toContain("dist/bundle.js");
  });

  test("root .saagaignore excludes matching files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "manifest-"));
    await writeAt(dir, ".saagaignore", "vendor/\n");
    await writeAt(dir, "src/foo.ts", "x");
    await writeAt(dir, "vendor/dep.js", "y");

    const result = paths(await computeManifest(dir));
    expect(result).toContain("src/foo.ts");
    expect(result).not.toContain("vendor/dep.js");
  });
});

describe("computeManifest — nested .gitignore", () => {
  test("nested .gitignore excludes only within its subtree", async () => {
    const dir = await mkdtemp(join(tmpdir(), "manifest-"));
    await writeAt(dir, "a/.gitignore", "*.log\n");
    await writeAt(dir, "a/debug.log", "log");
    await writeAt(dir, "a/keep.ts", "code");
    await writeAt(dir, "b/debug.log", "log in b");

    const result = paths(await computeManifest(dir));
    expect(result).not.toContain("a/debug.log");
    expect(result).toContain("a/keep.ts");
    expect(result).toContain("b/debug.log");
  });

  test("pattern is resolved relative to the nested directory, not app root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "manifest-"));
    await writeAt(dir, "lib/.gitignore", "tmp/\n");
    await writeAt(dir, "lib/tmp/cache.bin", "cached");
    await writeAt(dir, "lib/src/main.ts", "code");
    await writeAt(dir, "tmp/global.bin", "global");

    const result = paths(await computeManifest(dir));
    expect(result).not.toContain("lib/tmp/cache.bin");
    expect(result).toContain("lib/src/main.ts");
    expect(result).toContain("tmp/global.bin");
  });
});

describe("computeManifest — nested .saagaignore", () => {
  test("nested .saagaignore excludes within its subtree", async () => {
    const dir = await mkdtemp(join(tmpdir(), "manifest-"));
    await writeAt(dir, "pkg/.saagaignore", "generated/\n");
    await writeAt(dir, "pkg/generated/out.js", "gen");
    await writeAt(dir, "pkg/src/main.ts", "code");
    await writeAt(dir, "generated/top.js", "top");

    const result = paths(await computeManifest(dir));
    expect(result).not.toContain("pkg/generated/out.js");
    expect(result).toContain("pkg/src/main.ts");
    expect(result).toContain("generated/top.js");
  });

  test("nested .saagaignore file itself is excluded from manifest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "manifest-"));
    await writeAt(dir, "sub/.saagaignore", "*.tmp\n");
    await writeAt(dir, "sub/keep.ts", "code");

    const result = paths(await computeManifest(dir));
    expect(result).toContain("sub/keep.ts");
    expect(result).not.toContain("sub/.saagaignore");
  });
});

describe("computeManifest — negation", () => {
  test("nested negation re-includes a file ignored by a parent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "manifest-"));
    await writeAt(dir, ".gitignore", "*.log\n");
    await writeAt(dir, "a/.gitignore", "!important.log\n");
    await writeAt(dir, "a/important.log", "keep me");
    await writeAt(dir, "a/debug.log", "discard");
    await writeAt(dir, "b/other.log", "also discarded");

    const result = paths(await computeManifest(dir));
    expect(result).toContain("a/important.log");
    expect(result).not.toContain("a/debug.log");
    expect(result).not.toContain("b/other.log");
  });
});

describe("computeManifest — directory pruning", () => {
  test("re-include inside an ignored directory does NOT resurrect files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "manifest-"));
    await writeAt(dir, ".gitignore", "ignored_dir/\n");
    await writeAt(dir, "ignored_dir/.gitignore", "!rescue.ts\n");
    await writeAt(dir, "ignored_dir/rescue.ts", "try to rescue");
    await writeAt(dir, "ignored_dir/other.ts", "also gone");

    const result = paths(await computeManifest(dir));
    expect(result).not.toContain("ignored_dir/rescue.ts");
    expect(result).not.toContain("ignored_dir/other.ts");
  });
});

describe("computeManifest — mixed precedence", () => {
  test("root ignores *.tmp, nested .saagaignore overrides to keep data.tmp", async () => {
    const dir = await mkdtemp(join(tmpdir(), "manifest-"));
    await writeAt(dir, ".gitignore", "*.tmp\n");
    await writeAt(dir, "data/.saagaignore", "!data.tmp\n");
    await writeAt(dir, "data/data.tmp", "important");
    await writeAt(dir, "data/scratch.tmp", "noise");
    await writeAt(dir, "other.tmp", "top noise");

    const result = paths(await computeManifest(dir));
    expect(result).toContain("data/data.tmp");
    expect(result).not.toContain("data/scratch.tmp");
    expect(result).not.toContain("other.tmp");
  });

  test("deeper layer overrides shallower: root ignores, mid re-includes, leaf re-ignores", async () => {
    const dir = await mkdtemp(join(tmpdir(), "manifest-"));
    await writeAt(dir, ".gitignore", "*.gen\n");
    await writeAt(dir, "a/.gitignore", "!*.gen\n");
    await writeAt(dir, "a/b/.gitignore", "*.gen\n");
    await writeAt(dir, "a/file.gen", "kept by mid");
    await writeAt(dir, "a/b/file.gen", "re-ignored by leaf");
    await writeAt(dir, "top.gen", "ignored by root");

    const result = paths(await computeManifest(dir));
    expect(result).toContain("a/file.gen");
    expect(result).not.toContain("a/b/file.gen");
    expect(result).not.toContain("top.gen");
  });
});

describe("computeManifest — symlinks", () => {
  test("includes a symlinked file in the manifest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "manifest-"));
    await writeAt(dir, "real/config.json", "{}");
    await symlink("real/config.json", join(dir, "link.json"));

    const result = paths(await computeManifest(dir));
    expect(result).toContain("link.json");
    expect(result).toContain("real/config.json");
  });

  test("hashes a symlink as its target path (git-style), not the target's content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "manifest-"));
    await writeAt(dir, "real/config.json", "the file content");
    await symlink("real/config.json", join(dir, "link.json"));

    const entries = await computeManifest(dir);
    const linkEntry = entries.find((e) => e.path === "link.json");
    expect(linkEntry).toBeDefined();
    const target = await readlink(join(dir, "link.json"));
    expect(linkEntry?.hash).toBe(gitBlobHash(Buffer.from(target)));
    // The symlink hash must differ from a blob of the file's content.
    expect(linkEntry?.hash).not.toBe(gitBlobHash(Buffer.from("the file content")));
  });

  test("does not throw on a broken symlink and includes it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "manifest-"));
    await writeAt(dir, "keep.ts", "code");
    await symlink("does/not/exist.txt", join(dir, "broken.link"));

    const result = paths(await computeManifest(dir));
    expect(result).toContain("broken.link");
    expect(result).toContain("keep.ts");
  });

  test("does not traverse into a symlinked directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "manifest-"));
    await writeAt(dir, "target/inner.ts", "inner");
    await symlink("target", join(dir, "linkdir"));

    const result = paths(await computeManifest(dir));
    // The symlink itself is recorded, but its "contents" are not walked.
    expect(result).toContain("linkdir");
    expect(result).toContain("target/inner.ts");
    expect(result).not.toContain("linkdir/inner.ts");
  });

  test("respects ignore rules for symlinks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "manifest-"));
    await writeAt(dir, ".gitignore", "*.link\n");
    await writeAt(dir, "real.txt", "x");
    await symlink("real.txt", join(dir, "ignored.link"));

    const result = paths(await computeManifest(dir));
    expect(result).toContain("real.txt");
    expect(result).not.toContain("ignored.link");
  });
});

describe("computeManifest — hard excludes", () => {
  test(".git/ and docs/ are excluded at top level only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "manifest-"));
    await writeAt(dir, ".git/config", "gitconfig");
    await writeAt(dir, "docs/readme.md", "doc");
    await writeAt(dir, "src/foo.ts", "code");

    const result = paths(await computeManifest(dir));
    expect(result).toContain("src/foo.ts");
    expect(result.some((p) => p.startsWith(".git/"))).toBe(false);
    expect(result.some((p) => p.startsWith("docs/"))).toBe(false);
  });

  test("root .saagaignore is excluded from manifest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "manifest-"));
    await writeAt(dir, ".saagaignore", "vendor/\n");
    await writeAt(dir, "src/foo.ts", "x");

    const result = paths(await computeManifest(dir));
    expect(result).not.toContain(".saagaignore");
  });
});
