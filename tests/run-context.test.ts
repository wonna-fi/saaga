import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseDoc } from "../src/docs/frontmatter.js";
import { createRunContext } from "../src/run-context.js";

const RUN_ID_RE =
  /^[a-zA-Z0-9_.-]+-[a-zA-Z0-9-]+-\d{8}-\d{6}-[0-9a-f]{8}$/;

describe("createRunContext", () => {
  test("produces a run id of the form <app>-<sub>-<YYYYMMDD>-<HHMMSS>-<8hex>", async () => {
    const appDir = await mkdtemp(join(tmpdir(), "saaga-app-"));
    const ctx = await createRunContext({
      app: "salesforce",
      subcommand: "init",
      appPath: appDir,
    });

    expect(ctx.runId).toMatch(RUN_ID_RE);
    expect(ctx.runId.startsWith("salesforce-init-")).toBe(true);
  });

  test("places runDir under <appPath>/.saaga-runs/<run-id>", async () => {
    const appDir = await mkdtemp(join(tmpdir(), "saaga-app-"));
    const ctx = await createRunContext({
      app: "myapp",
      subcommand: "update",
      appPath: appDir,
    });

    const expected = join(appDir, ".saaga-runs", ctx.runId);
    expect(ctx.runDir).toBe(expected);
  });

  test("creates the run directory on disk", async () => {
    const appDir = await mkdtemp(join(tmpdir(), "saaga-app-"));
    const ctx = await createRunContext({
      app: "myapp",
      subcommand: "init",
      appPath: appDir,
    });

    const stats = await stat(ctx.runDir);
    expect(stats.isDirectory()).toBe(true);
  });

  test("two contexts produced back-to-back have distinct run ids", async () => {
    const appDir = await mkdtemp(join(tmpdir(), "saaga-app-"));
    const a = await createRunContext({
      app: "x",
      subcommand: "init",
      appPath: appDir,
    });
    const b = await createRunContext({
      app: "x",
      subcommand: "init",
      appPath: appDir,
    });
    expect(a.runId).not.toBe(b.runId);
  });

  test("returns app, appPath and subcommand on the context", async () => {
    const appDir = await mkdtemp(join(tmpdir(), "saaga-app-"));
    const ctx = await createRunContext({
      app: "salesforce",
      appPath: appDir,
      subcommand: "slice",
    });

    expect(ctx.app).toBe("salesforce");
    expect(ctx.appPath).toBe(appDir);
    expect(ctx.subcommand).toBe("slice");
  });

  test("exposes the run date in both run-id and ISO calendar form", async () => {
    const appDir = await mkdtemp(join(tmpdir(), "saaga-app-"));
    const ctx = await createRunContext({
      app: "myapp",
      subcommand: "init",
      appPath: appDir,
      now: new Date(2026, 7, 9, 13, 45, 12),
    });

    // `date` formats the run id; `isoDate` is what document frontmatter stores.
    expect(ctx.date).toBe("20260809");
    expect(ctx.isoDate).toBe("2026-08-09");
  });

  test("isoDate is a valid frontmatter date", async () => {
    const appDir = await mkdtemp(join(tmpdir(), "saaga-app-"));
    const ctx = await createRunContext({
      app: "myapp",
      subcommand: "init",
      appPath: appDir,
    });

    // The verify prompt writes this value straight into `last_verified`, so the
    // frontmatter parser has to accept it verbatim.
    const { frontmatter, errors } = parseDoc(
      `---\ntitle: T\ntype: concept\nlast_verified: ${ctx.isoDate}\n---\n\n# T\n`,
    );
    expect(errors).toEqual([]);
    expect(frontmatter?.last_verified).toBe(ctx.isoDate);
  });
});
