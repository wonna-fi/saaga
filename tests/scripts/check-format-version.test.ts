import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DEFAULT_DOCS_DIR } from "../../src/cli/config.js";
import {
  FORMAT_FILE,
  writeFormatVersion,
} from "../../src/docs/format-version.js";
import { checkFormatVersion } from "../../src/scripts/check-format-version.js";

/** App dir with no docs directory at all. */
async function greenfieldApp(): Promise<string> {
  const app = await mkdtemp(join(tmpdir(), "saaga-gate-"));
  await writeFile(join(app, "src.ts"), "x", "utf8");
  return app;
}

/** App dir whose docs directory holds documents but no FORMAT stamp. */
async function version0App(): Promise<string> {
  const app = await greenfieldApp();
  const docs = join(app, DEFAULT_DOCS_DIR);
  await mkdir(docs, { recursive: true });
  await writeFile(join(docs, "ARCHITECTURE.md"), "# Arch\n", "utf8");
  return app;
}

/** App dir whose docs directory is stamped at the current version. */
async function currentApp(): Promise<string> {
  const app = await version0App();
  await writeFormatVersion(join(app, DEFAULT_DOCS_DIR));
  return app;
}

function run(app: string, mode: string): Promise<void> {
  return checkFormatVersion(
    { app_dir: app, docs_dir: DEFAULT_DOCS_DIR, mode },
    { cwd: app },
  );
}

describe("check-format-version: state 1 — no corpus", () => {
  test("an absent docs directory passes in init mode", async () => {
    await expect(run(await greenfieldApp(), "init")).resolves.toBeUndefined();
  });

  test("an absent docs directory passes in update mode", async () => {
    await expect(run(await greenfieldApp(), "update")).resolves.toBeUndefined();
  });

  test("an empty docs directory passes in init mode", async () => {
    const app = await greenfieldApp();
    await mkdir(join(app, DEFAULT_DOCS_DIR), { recursive: true });

    await expect(run(app, "init")).resolves.toBeUndefined();
  });
});

describe("check-format-version: state 2 — existing corpus, update mode", () => {
  test("a matching version passes", async () => {
    await expect(run(await currentApp(), "update")).resolves.toBeUndefined();
  });

  test("a version-0 corpus fails naming the upgrade path", async () => {
    const app = await version0App();

    await expect(run(app, "update")).rejects.toThrow(
      /check-format-version: .*format version 0/,
    );
    await expect(run(app, "update")).rejects.toThrow(/'saaga run init'/);
    await expect(run(app, "update")).rejects.toThrow(
      new RegExp(`delete ${DEFAULT_DOCS_DIR}`),
    );
  });

  test("the version-0 message explains the missing stamp", async () => {
    await expect(run(await version0App(), "update")).rejects.toThrow(
      new RegExp(`${DEFAULT_DOCS_DIR}/${FORMAT_FILE}`),
    );
  });

  test("the version-0 message says it is not migrated in place", async () => {
    await expect(run(await version0App(), "update")).rejects.toThrow(
      /version-0 corpus is not migrated in place/,
    );
  });

  test("a future version fails too", async () => {
    const app = await version0App();
    await writeFile(
      join(app, DEFAULT_DOCS_DIR, FORMAT_FILE),
      "format_version: 99\n",
      "utf8",
    );

    await expect(run(app, "update")).rejects.toThrow(/format version 99/);
    await expect(run(app, "update")).rejects.not.toThrow(
      /version-0 corpus is not migrated/,
    );
  });
});

describe("check-format-version: state 3 — init over an existing corpus", () => {
  test("fails on a version-0 corpus with the delete-first message", async () => {
    const app = await version0App();

    await expect(run(app, "init")).rejects.toThrow(
      /does not overwrite an existing corpus/,
    );
    await expect(run(app, "init")).rejects.toThrow(
      new RegExp(`delete ${DEFAULT_DOCS_DIR}`),
    );
  });

  test("fails even when the corpus is at the current version", async () => {
    await expect(run(await currentApp(), "init")).rejects.toThrow(
      /does not overwrite an existing corpus/,
    );
  });
});

describe("check-format-version: argument validation", () => {
  test("requires app_dir", async () => {
    await expect(
      checkFormatVersion(
        { docs_dir: DEFAULT_DOCS_DIR, mode: "init" } as never,
        { cwd: "/x" },
      ),
    ).rejects.toThrow(/check-format-version: 'app_dir'/);
  });

  test("requires docs_dir", async () => {
    await expect(
      checkFormatVersion({ app_dir: "/x", mode: "init" } as never, {
        cwd: "/x",
      }),
    ).rejects.toThrow(/check-format-version: 'docs_dir'/);
  });

  test("rejects an unknown mode", async () => {
    await expect(run(await greenfieldApp(), "migrate")).rejects.toThrow(
      /'mode' must be "init" or "update"/,
    );
  });
});
