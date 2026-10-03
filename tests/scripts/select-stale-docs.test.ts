import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execa } from "execa";
import { describe, expect, test } from "vitest";
import { NonResumableError } from "../../src/engine/errors.js";
import { selectStaleDocs } from "../../src/scripts/select-stale-docs.js";

const DOCS = "saaga-docs";

async function tmp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `saaga-${prefix}-`));
}

async function put(root: string, rel: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, rel)), { recursive: true });
  await writeFile(join(root, rel), content, "utf8");
}

async function gitInit(dir: string): Promise<void> {
  await execa("git", ["init", "-q"], { cwd: dir });
}

/** Commits everything with author and committer date fixed to `date`. */
async function commitAll(dir: string, date: string, message = "change"): Promise<void> {
  const stamp = `${date}T12:00:00`;
  await execa("git", ["add", "-A"], { cwd: dir });
  await execa(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@test", "commit", "-q", "-m", message],
    { cwd: dir, env: { GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp } },
  );
}

function doc(opts: { type?: string; lastVerified?: string; sources?: string[] } = {}): string {
  const lines = ["---", "title: Doc", `type: ${opts.type ?? "concept"}`];
  if (opts.lastVerified) lines.push(`last_verified: ${opts.lastVerified}`);
  if (opts.sources) {
    lines.push("sources:", ...opts.sources.map((s) => `  - ${s}`));
  }
  lines.push("---", "", "# Doc", "", "Body.", "");
  return lines.join("\n");
}

/** A git repo with one initial commit dated 2020-01-01. */
async function repo(files: Record<string, string>): Promise<string> {
  const dir = await tmp("stale");
  await gitInit(dir);
  for (const [rel, content] of Object.entries(files)) await put(dir, rel, content);
  await commitAll(dir, "2020-01-01", "initial");
  return dir;
}

async function select(appDir: string, docsDir = DOCS) {
  const out = await tmp("stale-out");
  const warnings: string[] = [];
  const result = await selectStaleDocs(
    { app_dir: appDir, docs_dir: docsDir, output_dir: out },
    { cwd: appDir, warn: (m) => warnings.push(m) },
  );
  const report = await readFile(result.report_path, "utf8");
  return { result, report, warnings };
}

/** The `## <path>` headings of a report, i.e. the selected documents. */
function selectedPaths(report: string): string[] {
  return [...report.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
}

describe("select-stale-docs argument validation", () => {
  test.each(["app_dir", "docs_dir", "output_dir"])("rejects a missing '%s'", async (key) => {
    const args: Record<string, string> = { app_dir: "/a", docs_dir: "d", output_dir: "/o" };
    delete args[key];
    await expect(
      selectStaleDocs(args as never, { cwd: "/a" }),
    ).rejects.toThrow(`'${key}' arg is required`);
  });
});

describe("select-stale-docs requires git history", () => {
  test("refuses a directory that is not a git repository", async () => {
    const dir = await tmp("nogit");
    await put(dir, `${DOCS}/concepts/a.md`, doc());
    const err = await select(dir).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NonResumableError);
    expect((err as Error).message).toContain("is not a git repository");
  });

  test("refuses a repository with no commits", async () => {
    const dir = await tmp("nocommit");
    await gitInit(dir);
    await put(dir, `${DOCS}/concepts/a.md`, doc());
    const err = await select(dir).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NonResumableError);
    expect((err as Error).message).toContain("has no commits");
  });

  test("refuses a shallow clone and names the fix", async () => {
    const origin = await repo({ "src/a.ts": "a", [`${DOCS}/concepts/a.md`]: doc() });
    await put(origin, "src/a.ts", "b");
    await commitAll(origin, "2020-01-05");
    const parent = await tmp("shallow");
    const clone = join(parent, "clone");
    await execa("git", ["clone", "-q", "--depth", "1", `file://${origin}`, clone]);
    const err = await select(clone).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NonResumableError);
    expect((err as Error).message).toContain("shallow clone");
    expect((err as Error).message).toContain("fetch-depth: 0");
  });
});

describe("select-stale-docs selection", () => {
  test("selects a document whose source changed after its last verification", async () => {
    const dir = await repo({
      "src/a.ts": "a",
      [`${DOCS}/concepts/a.md`]: doc({ lastVerified: "2020-01-02", sources: ["src/a.ts"] }),
    });
    await put(dir, "src/a.ts", "changed");
    await commitAll(dir, "2020-01-05");

    const { result, report } = await select(dir);
    expect(result.count).toBe(1);
    expect(selectedPaths(report)).toEqual([`${DOCS}/concepts/a.md`]);
    expect(report).toContain("`sources-changed`");
    expect(report).toContain("`src/a.ts`");
    expect(report).toContain("**Last verified**: 2020-01-02");
  });

  test("leaves a document whose sources did not change since its verification", async () => {
    const dir = await repo({
      "src/a.ts": "a",
      [`${DOCS}/concepts/a.md`]: doc({ lastVerified: "2020-01-10", sources: ["src/a.ts"] }),
    });
    await put(dir, "src/a.ts", "changed");
    await commitAll(dir, "2020-01-05");

    const { result } = await select(dir);
    expect(result.count).toBe(0);
  });

  test("leaves a document when only an unrelated source changed", async () => {
    const dir = await repo({
      "src/a.ts": "a",
      "src/b.ts": "b",
      [`${DOCS}/concepts/a.md`]: doc({ lastVerified: "2020-01-02", sources: ["src/a.ts"] }),
    });
    await put(dir, "src/b.ts", "changed");
    await commitAll(dir, "2020-01-05");

    expect((await select(dir)).result.count).toBe(0);
  });

  test("counts a change made on the verification day itself", async () => {
    const dir = await repo({
      "src/a.ts": "a",
      [`${DOCS}/concepts/a.md`]: doc({ lastVerified: "2020-01-05", sources: ["src/a.ts"] }),
    });
    await put(dir, "src/a.ts", "changed");
    await commitAll(dir, "2020-01-05");

    expect((await select(dir)).result.count).toBe(1);
  });

  test("conservatively selects a document with no frontmatter", async () => {
    const dir = await repo({ [`${DOCS}/concepts/a.md`]: "# Plain\n\nNo frontmatter.\n" });
    const { result, report } = await select(dir);
    expect(result.count).toBe(1);
    expect(report).toContain("`no-frontmatter`");
  });

  test("selects a document that was never verified", async () => {
    const dir = await repo({ [`${DOCS}/concepts/a.md`]: doc({ sources: ["src/a.ts"] }) });
    const { result, report } = await select(dir);
    expect(result.count).toBe(1);
    expect(report).toContain("`never-verified`");
    expect(report).toContain("**Last verified**: —");
  });

  test("selects a verified document that declares no sources", async () => {
    const dir = await repo({ [`${DOCS}/concepts/a.md`]: doc({ lastVerified: "2020-01-02" }) });
    const { result, report } = await select(dir);
    expect(result.count).toBe(1);
    expect(report).toContain("`no-sources`");
  });

  test("leaves a verified convention, which never declares sources", async () => {
    const dir = await repo({
      [`${DOCS}/conventions/naming.md`]: doc({ type: "convention", lastVerified: "2020-01-02" }),
    });
    expect((await select(dir)).result.count).toBe(0);
  });

  test("still selects a convention that was never verified", async () => {
    const dir = await repo({ [`${DOCS}/conventions/naming.md`]: doc({ type: "convention" }) });
    const { report } = await select(dir);
    expect(report).toContain("`never-verified`");
  });

  test.each([
    ["a directory with a trailing slash", "src/engine/"],
    ["a directory without a trailing slash", "src/engine"],
    ["a glob", "src/**/*.ts"],
    ["a './'-prefixed path", "./src/engine/runner.ts"],
  ])("matches a source given as %s", async (_label, source) => {
    const dir = await repo({
      "src/engine/runner.ts": "a",
      [`${DOCS}/concepts/a.md`]: doc({ lastVerified: "2020-01-02", sources: [source] }),
    });
    await put(dir, "src/engine/runner.ts", "changed");
    await commitAll(dir, "2020-01-05");

    expect((await select(dir)).result.count).toBe(1);
  });

  test("selects on uncommitted changes, tracked and untracked", async () => {
    const dir = await repo({
      "src/a.ts": "a",
      [`${DOCS}/concepts/a.md`]: doc({ lastVerified: "2099-01-01", sources: ["src/a.ts"] }),
      [`${DOCS}/concepts/b.md`]: doc({ lastVerified: "2099-01-01", sources: ["src/new/"] }),
    });
    await put(dir, "src/a.ts", "edited, not committed");
    await put(dir, "src/new/file.ts", "untracked");

    const { report } = await select(dir);
    expect(selectedPaths(report)).toEqual([`${DOCS}/concepts/a.md`, `${DOCS}/concepts/b.md`]);
  });

  test("an edit to the documentation itself is not a source change", async () => {
    const dir = await repo({
      [`${DOCS}/concepts/a.md`]: doc({ lastVerified: "2020-01-02", sources: [`${DOCS}/`, "src/"] }),
    });
    await put(dir, `${DOCS}/concepts/other.md`, doc({ lastVerified: "2099-01-01", sources: ["x"] }));
    await commitAll(dir, "2020-01-05");

    expect((await select(dir)).result.count).toBe(0);
  });

  test("never selects generated navigation, and does select ARCHITECTURE.md", async () => {
    const dir = await repo({
      "src/a.ts": "a",
      [`${DOCS}/README.md`]: doc({ type: "index" }),
      [`${DOCS}/GLOSSARY.md`]: "# Glossary\n",
      [`${DOCS}/concepts/INDEX.md`]: "# Concept Index\n",
      [`${DOCS}/features/index-like.md`]: doc({ type: "index" }),
      [`${DOCS}/ARCHITECTURE.md`]: doc({
        type: "architecture",
        lastVerified: "2020-01-02",
        sources: ["src/"],
      }),
    });
    await put(dir, "src/a.ts", "changed");
    await commitAll(dir, "2020-01-05");

    const { report } = await select(dir);
    expect(selectedPaths(report)).toEqual([`${DOCS}/ARCHITECTURE.md`]);
  });

  test("ignores archived run metadata under the docs directory", async () => {
    const dir = await repo({
      [`${DOCS}/metadata/quick_updates/x/summary.md`]: "# Summary\n",
    });
    expect((await select(dir)).result.count).toBe(0);
  });

  test("resolves paths relative to an app directory below the repository root", async () => {
    const root = await repo({
      "apps/web/src/a.ts": "a",
      "other/src/a.ts": "a",
      [`apps/web/${DOCS}/concepts/a.md`]: doc({ lastVerified: "2020-01-02", sources: ["src/a.ts"] }),
    });
    // A same-named file outside the app must not count.
    await put(root, "other/src/a.ts", "changed");
    await commitAll(root, "2020-01-05");
    const app = join(root, "apps", "web");
    expect((await select(app)).result.count).toBe(0);

    await put(root, "apps/web/src/a.ts", "changed");
    await commitAll(root, "2020-01-06");
    const { report } = await select(app);
    expect(selectedPaths(report)).toEqual([`${DOCS}/concepts/a.md`]);
    expect(report).toContain("`src/a.ts`");
  });

  test("warns with the selection summary, and stays quiet when nothing is stale", async () => {
    const dir = await repo({ [`${DOCS}/concepts/a.md`]: doc() });
    const { warnings } = await select(dir);
    expect(warnings).toEqual(["select-stale-docs: 1 stale document(s) (1 never-verified)"]);

    const clean = await repo({
      [`${DOCS}/concepts/a.md`]: doc({ lastVerified: "2099-01-01", sources: ["src/"] }),
    });
    expect((await select(clean)).warnings).toEqual([]);
  });

  test("truncates a long list of changed sources", async () => {
    const files: Record<string, string> = {
      [`${DOCS}/concepts/a.md`]: doc({ lastVerified: "2020-01-02", sources: ["src/"] }),
    };
    for (let i = 0; i < 25; i++) files[`src/f${String(i).padStart(2, "0")}.ts`] = "a";
    const dir = await repo(files);
    for (let i = 0; i < 25; i++) await put(dir, `src/f${String(i).padStart(2, "0")}.ts`, "b");
    await commitAll(dir, "2020-01-05");

    const { report } = await select(dir);
    expect(report).toContain("`src/f19.ts`");
    expect(report).not.toContain("`src/f20.ts`");
    expect(report).toContain("+5 more");
  });
});

describe("select-stale-docs regression: the READ_ONLY_GIT rename", () => {
  /**
   * Renaming the `read-only-git` profile left stale claims in two documents
   * outside every slice that later ran. Both cover the renamed file; a third
   * document covering untouched code must stay out of the selection.
   */
  test("selects both documents covering a renamed source, and only those", async () => {
    const dir = await repo({
      "src/permissions.ts": "export const READ_ONLY_GIT = 'read-only-git';\n",
      "src/other.ts": "export const other = 1;\n",
      [`${DOCS}/concepts/agent-permissions.md`]: doc({
        lastVerified: "2020-01-02",
        sources: ["src/permissions.ts"],
      }),
      [`${DOCS}/features/cli-entry-point.md`]: doc({
        type: "feature",
        lastVerified: "2020-01-02",
        sources: ["src/permissions.ts", "src/cli.ts"],
      }),
      [`${DOCS}/concepts/other.md`]: doc({
        lastVerified: "2020-01-02",
        sources: ["src/other.ts"],
      }),
    });
    await rename(join(dir, "src/permissions.ts"), join(dir, "src/profiles.ts"));
    await put(dir, "src/profiles.ts", "export const RESTRICTED = 'restricted';\n");
    await commitAll(dir, "2020-01-05", "rename read-only-git to restricted");

    const { result, report } = await select(dir);
    expect(result.count).toBe(2);
    expect(selectedPaths(report)).toEqual([
      `${DOCS}/concepts/agent-permissions.md`,
      `${DOCS}/features/cli-entry-point.md`,
    ]);
    expect(report).toContain("`src/permissions.ts`");
  });
});
