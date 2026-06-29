import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { DEFAULT_DOCS_DIR } from "../../src/cli/config.js";
import { detectChanges } from "../../src/scripts/detect-changes.js";
import { generateBaseline } from "../../src/scripts/generate-baseline.js";

async function writeAt(
  dir: string,
  relpath: string,
  content: string,
): Promise<void> {
  const p = join(dir, relpath);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, content, "utf8");
}

async function makeBaselineDir(): Promise<{
  app: string;
  outDir: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "saaga-dc-"));
  const app = join(root, "app");
  await mkdir(app);
  await writeAt(app, "src/foo.ts", "alpha");
  await writeAt(app, "src/bar.ts", "beta");
  await writeAt(app, "README.md", "readme");
  await generateBaseline({ app_dir: app, docs_dir: DEFAULT_DOCS_DIR }, { cwd: app });
  const outDir = join(root, "out");
  await mkdir(outDir, { recursive: true });
  return { app, outDir };
}

describe("detect-changes script", () => {
  test("returns zero count and writes a report when nothing changed", async () => {
    const { app, outDir } = await makeBaselineDir();
    const result = await detectChanges(
      { app_dir: app, output_dir: outDir, docs_dir: DEFAULT_DOCS_DIR },
      { cwd: app },
    );
    expect(result.count).toBe(0);
    const report = await readFile(result.changes_path, "utf8");
    expect(report).toContain("# Changes Since BASELINE");
    expect(report).toMatch(/0 changed, 0 new, 0 deleted, 0 ignored/);
  });

  test("classifies a modified file as 'changed'", async () => {
    const { app, outDir } = await makeBaselineDir();
    await writeAt(app, "src/foo.ts", "alpha-modified");

    const result = await detectChanges(
      { app_dir: app, output_dir: outDir, docs_dir: DEFAULT_DOCS_DIR },
      { cwd: app },
    );
    expect(result.count).toBe(1);
    expect(result.changed).toBe(1);
    const report = await readFile(result.changes_path, "utf8");
    expect(report).toMatch(/## Changed Files\s+- `src\/foo\.ts`/);
    expect(report).toMatch(/## New Files\s+_None_/);
  });

  test("classifies a brand-new file as 'new'", async () => {
    const { app, outDir } = await makeBaselineDir();
    await writeAt(app, "src/baz.ts", "newcontent");

    const result = await detectChanges(
      { app_dir: app, output_dir: outDir, docs_dir: DEFAULT_DOCS_DIR },
      { cwd: app },
    );
    expect(result.count).toBe(1);
    expect(result.new).toBe(1);
    const report = await readFile(result.changes_path, "utf8");
    expect(report).toMatch(/## New Files\s+- `src\/baz\.ts`/);
  });

  test("includes untracked (non-git-added) files as 'new'", async () => {
    const { app, outDir } = await makeBaselineDir();
    await writeAt(app, "src/untracked-feature.ts", "brand new untracked file");

    const result = await detectChanges(
      { app_dir: app, output_dir: outDir, docs_dir: DEFAULT_DOCS_DIR },
      { cwd: app },
    );
    expect(result.count).toBe(1);
    expect(result.new).toBe(1);
    const report = await readFile(result.changes_path, "utf8");
    expect(report).toMatch(/## New Files\s+- `src\/untracked-feature\.ts`/);
  });

  test("classifies a previously-ignored, now-visible file as 'new'", async () => {
    const root = await mkdtemp(join(tmpdir(), "saaga-dc-"));
    const app = join(root, "app");
    await mkdir(app);
    await writeAt(app, "src/foo.ts", "alpha");
    await writeAt(app, "vendor/dep.ts", "vendored");
    await writeAt(app, ".saagaignore", "vendor/\n");
    await generateBaseline({ app_dir: app, docs_dir: DEFAULT_DOCS_DIR }, { cwd: app });

    await writeAt(app, ".saagaignore", "");

    const outDir = join(root, "out");
    await mkdir(outDir, { recursive: true });

    const result = await detectChanges(
      { app_dir: app, output_dir: outDir, docs_dir: DEFAULT_DOCS_DIR },
      { cwd: app },
    );
    expect(result.new).toBe(1);
    const report = await readFile(result.changes_path, "utf8");
    expect(report).toMatch(/## New Files\s+- `vendor\/dep\.ts`/);
  });

  test("classifies a deleted file as 'truly deleted'", async () => {
    const { app, outDir } = await makeBaselineDir();
    await rm(join(app, "src/foo.ts"));

    const result = await detectChanges(
      { app_dir: app, output_dir: outDir, docs_dir: DEFAULT_DOCS_DIR },
      { cwd: app },
    );
    expect(result.count).toBe(1);
    expect(result.truly_deleted).toBe(1);
    const report = await readFile(result.changes_path, "utf8");
    expect(report).toMatch(/## Deleted Files\s+- `src\/foo\.ts`/);
    expect(report).toMatch(/## Newly Ignored Files\s+_None_/);
  });

  test("classifies a still-existing-but-now-ignored file as 'newly ignored'", async () => {
    const root = await mkdtemp(join(tmpdir(), "saaga-dc-"));
    const app = join(root, "app");
    await mkdir(app);
    await writeAt(app, "src/foo.ts", "alpha");
    await writeAt(app, "vendor/dep.ts", "vendored");
    await generateBaseline({ app_dir: app, docs_dir: DEFAULT_DOCS_DIR }, { cwd: app });

    await writeAt(app, ".saagaignore", "vendor/\n");

    const outDir = join(root, "out");
    await mkdir(outDir, { recursive: true });

    const result = await detectChanges(
      { app_dir: app, output_dir: outDir, docs_dir: DEFAULT_DOCS_DIR },
      { cwd: app },
    );
    expect(result.newly_ignored).toBe(1);
    expect(result.truly_deleted).toBe(0);
    const report = await readFile(result.changes_path, "utf8");
    expect(report).toMatch(/## Newly Ignored Files\s+- `vendor\/dep\.ts`/);
  });

  test("classifies a file replaced by a same-named directory as 'truly deleted'", async () => {
    const { app, outDir } = await makeBaselineDir();
    // src/foo.ts was a file in the baseline; replace it with a directory
    // of the same name containing a different file.
    await rm(join(app, "src/foo.ts"));
    await writeAt(app, "src/foo.ts/inner.ts", "now a directory");

    const result = await detectChanges(
      { app_dir: app, output_dir: outDir, docs_dir: DEFAULT_DOCS_DIR },
      { cwd: app },
    );
    expect(result.truly_deleted).toBe(1);
    expect(result.newly_ignored).toBe(0);
    const report = await readFile(result.changes_path, "utf8");
    expect(report).toMatch(/## Deleted Files\s+- `src\/foo\.ts`/);
  });

  test("requires the app_dir arg", async () => {
    await expect(
      detectChanges(
        {} as { app_dir: string; output_dir: string; docs_dir: string },
        { cwd: "/x" },
      ),
    ).rejects.toThrow(/app_dir/);
  });

  test("rejects when BASELINE file is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "saaga-dc-"));
    const app = join(root, "app");
    await mkdir(app);
    await writeAt(app, "src/foo.ts", "alpha");
    const outDir = join(root, "out");
    await mkdir(outDir, { recursive: true });
    await expect(
      detectChanges({ app_dir: app, output_dir: outDir, docs_dir: DEFAULT_DOCS_DIR }, { cwd: app }),
    ).rejects.toThrow(/BASELINE/);
  });

  test("respects .gitignore exclusions", async () => {
    const root = await mkdtemp(join(tmpdir(), "saaga-dc-"));
    const app = join(root, "app");
    await mkdir(app);
    await writeAt(app, "src/foo.ts", "alpha");
    await writeAt(app, ".gitignore", "dist/\n");
    await generateBaseline({ app_dir: app, docs_dir: DEFAULT_DOCS_DIR }, { cwd: app });

    await writeAt(app, "dist/bundle.js", "compiled");

    const outDir = join(root, "out");
    await mkdir(outDir, { recursive: true });
    const result = await detectChanges(
      { app_dir: app, output_dir: outDir, docs_dir: DEFAULT_DOCS_DIR },
      { cwd: app },
    );
    expect(result.count).toBe(0);
  });
});

describe("detect-changes script registration", () => {
  beforeEach(() => {});
  test("is registered in the default script registry", async () => {
    const { defaultScriptRegistry } = await import(
      "../../src/scripts/registry.js"
    );
    expect(defaultScriptRegistry["detect-changes"]).toBeDefined();
  });
});
