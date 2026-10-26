import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DEFAULT_DOCS_DIR } from "../../src/cli/config.js";
import { ensureDocsDirs } from "../../src/scripts/ensure-docs-dirs.js";

const CATEGORIES = ["concepts", "patterns", "conventions", "features"];

async function tmpApp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "saaga-docs-dirs-"));
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

describe("ensure-docs-dirs script", () => {
  test("create makes the docs directory and every category under it", async () => {
    const app = await tmpApp();

    await ensureDocsDirs(
      { app_dir: app, docs_dir: DEFAULT_DOCS_DIR, mode: "create" },
      { cwd: app },
    );

    expect((await readdir(join(app, DEFAULT_DOCS_DIR))).sort()).toEqual(
      [...CATEGORIES].sort(),
    );
  });

  test("create accepts an absolute docs_dir", async () => {
    const app = await tmpApp();
    const docs = join(app, "nested", "docs");

    await ensureDocsDirs({ app_dir: app, docs_dir: docs, mode: "create" }, { cwd: app });

    for (const category of CATEGORIES) {
      expect(await isDir(join(docs, category))).toBe(true);
    }
  });

  test("create is idempotent and leaves existing files alone", async () => {
    const app = await tmpApp();
    const docs = join(app, DEFAULT_DOCS_DIR);
    await mkdir(join(docs, "concepts"), { recursive: true });
    await writeFile(join(docs, "concepts", "INDEX.md"), "# Concepts\n", "utf8");

    const args = { app_dir: app, docs_dir: DEFAULT_DOCS_DIR, mode: "create" };
    await ensureDocsDirs(args, { cwd: app });
    await ensureDocsDirs(args, { cwd: app });

    expect(await readFile(join(docs, "concepts", "INDEX.md"), "utf8")).toBe("# Concepts\n");
  });

  test("prune removes only the empty category directories", async () => {
    const app = await tmpApp();
    const docs = join(app, DEFAULT_DOCS_DIR);
    await ensureDocsDirs(
      { app_dir: app, docs_dir: DEFAULT_DOCS_DIR, mode: "create" },
      { cwd: app },
    );
    await writeFile(join(docs, "concepts", "INDEX.md"), "", "utf8");

    await ensureDocsDirs(
      { app_dir: app, docs_dir: DEFAULT_DOCS_DIR, mode: "prune" },
      { cwd: app },
    );

    expect(await readdir(docs)).toEqual(["concepts"]);
  });

  test("prune never removes the docs directory and tolerates missing categories", async () => {
    const app = await tmpApp();
    const docs = join(app, DEFAULT_DOCS_DIR);
    await mkdir(docs);

    await ensureDocsDirs(
      { app_dir: app, docs_dir: DEFAULT_DOCS_DIR, mode: "prune" },
      { cwd: app },
    );

    expect(await isDir(docs)).toBe(true);
  });

  test("requires the 'app_dir' arg", async () => {
    await expect(
      ensureDocsDirs({ docs_dir: DEFAULT_DOCS_DIR, mode: "create" } as never, { cwd: "/x" }),
    ).rejects.toThrow(/ensure-docs-dirs: 'app_dir'/);
  });

  test("requires the 'docs_dir' arg", async () => {
    await expect(
      ensureDocsDirs({ app_dir: "/x", mode: "create" } as never, { cwd: "/x" }),
    ).rejects.toThrow(/ensure-docs-dirs: 'docs_dir'/);
  });

  test("rejects an unknown mode", async () => {
    await expect(
      ensureDocsDirs({ app_dir: "/x", docs_dir: DEFAULT_DOCS_DIR, mode: "nope" }, { cwd: "/x" }),
    ).rejects.toThrow(/ensure-docs-dirs: 'mode' must be "create" or "prune" \(got "nope"\)/);
  });
});
