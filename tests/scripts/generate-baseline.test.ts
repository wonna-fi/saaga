import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { DEFAULT_DOCS_DIR } from "../../src/cli/config.js";
import { gitBlobHash } from "../../src/scripts/file-manifest.js";
import { generateBaseline } from "../../src/scripts/generate-baseline.js";

async function writeAt(dir: string, relpath: string, content: string): Promise<void> {
  const p = join(dir, relpath);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, content, "utf8");
}

async function readBaseline(dir: string): Promise<string[]> {
  const content = await readFile(join(dir, DEFAULT_DOCS_DIR, "BASELINE"), "utf8");
  return content.split("\n").filter((l) => l.length > 0);
}

describe("generate-baseline script", () => {
  test("writes the Generated header line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-bl-"));
    await writeAt(dir, "src/foo.ts", "x");

    await generateBaseline({ app_dir: dir, docs_dir: DEFAULT_DOCS_DIR }, { cwd: dir });

    const lines = await readBaseline(dir);
    expect(lines[0]).toMatch(/^# Generated: /);
    expect(lines[1]).toMatch(/^[0-9a-f]{40} /);
  });

  test("lists `<hash> <relpath>` for every in-scope file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-bl-"));
    await writeAt(dir, "src/foo.ts", "alpha");
    await writeAt(dir, "README.md", "beta");

    await generateBaseline({ app_dir: dir, docs_dir: DEFAULT_DOCS_DIR }, { cwd: dir });

    const lines = await readBaseline(dir);
    const fileLines = lines.slice(1);
    expect(fileLines).toHaveLength(2);
    for (const line of fileLines) {
      expect(line).toMatch(/^[0-9a-f]{40} .+$/);
    }

    for (const line of fileLines) {
      const match = /^([0-9a-f]{40}) (.+)$/.exec(line);
      expect(match).not.toBeNull();
      const [, hash, path] = match!;
      const content = await readFile(join(dir, path));
      expect(gitBlobHash(content)).toBe(hash);
    }
  });

  test("excludes files under the docs dir and the .saagaignore file itself", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-bl-"));
    await writeAt(dir, "src/foo.ts", "x");
    await writeAt(dir, `${DEFAULT_DOCS_DIR}/ARCHITECTURE.md`, "doc");
    await writeAt(dir, ".saagaignore", "build/\n");

    await generateBaseline({ app_dir: dir, docs_dir: DEFAULT_DOCS_DIR }, { cwd: dir });

    const lines = await readBaseline(dir);
    const fileLines = lines.slice(1);
    const paths = fileLines.map((l) => l.split(" ").slice(1).join(" "));
    expect(paths).toContain("src/foo.ts");
    expect(paths).not.toContain(`${DEFAULT_DOCS_DIR}/ARCHITECTURE.md`);
    expect(paths).not.toContain(".saagaignore");
  });

  test("excludes files matched by .saagaignore patterns", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-bl-"));
    await writeAt(dir, "src/foo.ts", "x");
    await writeAt(dir, "build/output.js", "ignored");
    await writeAt(dir, "vendor/dep.js", "vendored");
    await writeAt(dir, ".saagaignore", "build/\nvendor/\n");

    await generateBaseline({ app_dir: dir, docs_dir: DEFAULT_DOCS_DIR }, { cwd: dir });

    const lines = await readBaseline(dir);
    const fileLines = lines.slice(1);
    const paths = fileLines.map((l) => l.split(" ").slice(1).join(" "));
    expect(paths).toContain("src/foo.ts");
    expect(paths).not.toContain("build/output.js");
    expect(paths).not.toContain("vendor/dep.js");
  });

  test("excludes files matched by .gitignore patterns", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-bl-"));
    await writeAt(dir, "src/foo.ts", "x");
    await writeAt(dir, "dist/bundle.js", "compiled");
    await writeAt(dir, "node_modules/dep/index.js", "dep");
    await writeAt(dir, ".gitignore", "dist/\nnode_modules/\n");

    await generateBaseline({ app_dir: dir, docs_dir: DEFAULT_DOCS_DIR }, { cwd: dir });

    const lines = await readBaseline(dir);
    const fileLines = lines.slice(1);
    const paths = fileLines.map((l) => l.split(" ").slice(1).join(" "));
    expect(paths).toContain("src/foo.ts");
    expect(paths).toContain(".gitignore");
    expect(paths).not.toContain("dist/bundle.js");
    expect(paths).not.toContain("node_modules/dep/index.js");
  });

  test("includes untracked files (not staged or committed)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-bl-"));
    await writeAt(dir, "src/foo.ts", "existing");
    await writeAt(dir, "src/new-feature.ts", "brand new untracked");

    await generateBaseline({ app_dir: dir, docs_dir: DEFAULT_DOCS_DIR }, { cwd: dir });

    const lines = await readBaseline(dir);
    const paths = lines.slice(1).map((l) => l.split(" ").slice(1).join(" "));
    expect(paths).toContain("src/foo.ts");
    expect(paths).toContain("src/new-feature.ts");
  });

  test("works on non-git directories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-bl-"));
    await writeAt(dir, "src/foo.ts", "x");

    await generateBaseline({ app_dir: dir, docs_dir: DEFAULT_DOCS_DIR }, { cwd: dir });

    const lines = await readBaseline(dir);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0]).toMatch(/^# Generated: /);
  });

  test("requires the 'app_dir' arg", async () => {
    await expect(
      generateBaseline({} as { app_dir: string; docs_dir: string }, { cwd: "/x" }),
    ).rejects.toThrow(/app_dir/);
  });

  test("skips .git directory contents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-bl-"));
    await writeAt(dir, "src/foo.ts", "x");
    await writeAt(dir, ".git/config", "gitconfig");
    await writeAt(dir, ".git/objects/ab/1234", "obj");

    await generateBaseline({ app_dir: dir, docs_dir: DEFAULT_DOCS_DIR }, { cwd: dir });

    const lines = await readBaseline(dir);
    const paths = lines.slice(1).map((l) => l.split(" ").slice(1).join(" "));
    expect(paths).toContain("src/foo.ts");
    expect(paths.some((p) => p.startsWith(".git/"))).toBe(false);
  });
});
