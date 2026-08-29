import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DEFAULT_DOCS_DIR } from "../../src/cli/config.js";
import {
  CURRENT_FORMAT_VERSION,
  FORMAT_FILE,
} from "../../src/docs/format-version.js";
import { stampFormatVersion } from "../../src/scripts/stamp-format-version.js";

describe("stamp-format-version script", () => {
  test("writes the stamp into the docs directory", async () => {
    const app = await mkdtemp(join(tmpdir(), "saaga-stamp-"));

    await stampFormatVersion(
      { app_dir: app, docs_dir: DEFAULT_DOCS_DIR },
      { cwd: app },
    );

    const content = await readFile(
      join(app, DEFAULT_DOCS_DIR, FORMAT_FILE),
      "utf8",
    );
    expect(content).toBe(`format_version: ${CURRENT_FORMAT_VERSION}\n`);
  });

  test("requires the 'app_dir' arg", async () => {
    await expect(
      stampFormatVersion({ docs_dir: DEFAULT_DOCS_DIR } as never, {
        cwd: "/x",
      }),
    ).rejects.toThrow(/stamp-format-version: 'app_dir'/);
  });

  test("requires the 'docs_dir' arg", async () => {
    await expect(
      stampFormatVersion({ app_dir: "/x" } as never, { cwd: "/x" }),
    ).rejects.toThrow(/stamp-format-version: 'docs_dir'/);
  });
});
