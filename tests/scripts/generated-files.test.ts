import { chmod, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import { CURRENT_FORMAT_VERSION, readFormatVersion } from "../../src/docs/format-version.js";
import { generateBaseline } from "../../src/scripts/generate-baseline.js";
import { generateNavigation } from "../../src/scripts/generate-navigation.js";
import { stampFormatVersion } from "../../src/scripts/stamp-format-version.js";
import { validateDocs } from "../../src/scripts/validate-docs.js";

test.each(["file", "symlink"])("finalization preserves existing %s permissions without changing source", async (kind) => {
  const app = await mkdtemp(join(tmpdir(), "saaga-finalize-"));
  const docs = join(app, "saaga-docs");
  try {
    await mkdir(join(docs, "concepts"), { recursive: true });
    await writeFile(join(app, "source.ts"), "export const original = true;\n");
    await writeFile(join(docs, "ARCHITECTURE.md"), "# Architecture\n");
    await writeFile(join(docs, "concepts", "thing.md"), "# Thing\n");
    await writeFile(join(docs, "concepts", "INDEX.md"),
      "# Concepts\n\n| Name | Description |\n|---|---|\n| [Thing](./thing.md) | A documented thing. |\n");
    for (const name of ["BASELINE", "FORMAT", "README.md", "GLOSSARY.md"]) {
      const target = kind === "symlink" ? join(app, name) : join(docs, name);
      await writeFile(target, "previous");
      await chmod(target, 0o600);
      if (kind === "symlink") await symlink(target, join(docs, name));
    }

    const args = { app_dir: app, docs_dir: "saaga-docs", app: "demo" };
    const ctx = { cwd: app };
    await generateBaseline(args, ctx);
    await stampFormatVersion(args, ctx);
    await generateNavigation(args, ctx);
    await validateDocs({ ...args, output_dir: join(app, ".saaga-runs") }, ctx);

    expect(await readFormatVersion(docs)).toEqual({ state: "corpus", version: CURRENT_FORMAT_VERSION });
    expect(await readFile(join(docs, "BASELINE"), "utf8")).toContain("source.ts");
    expect(await readFile(join(docs, "README.md"), "utf8")).toContain("# demo Documentation");
    expect(await readFile(join(docs, "GLOSSARY.md"), "utf8")).toContain("# Glossary");
    expect(await readFile(join(app, "source.ts"), "utf8")).toBe("export const original = true;\n");
    for (const name of ["BASELINE", "FORMAT", "README.md", "GLOSSARY.md"]) {
      const path = join(docs, name);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect((await lstat(path)).isSymbolicLink()).toBe(kind === "symlink");
      if (kind === "symlink") {
        expect(await readFile(join(app, name), "utf8")).toBe(await readFile(path, "utf8"));
      }
    }
  } finally {
    await rm(app, { recursive: true, force: true });
  }
});
