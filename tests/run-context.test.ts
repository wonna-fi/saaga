import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createRunContext } from "../src/run-context.js";

const RUN_ID_RE =
  /^[a-zA-Z0-9_.-]+-[a-zA-Z0-9-]+-\d{8}-\d{6}-[0-9a-f]{8}$/;

describe("createRunContext", () => {
  test("produces a run id of the form <app>-<sub>-<YYYYMMDD>-<HHMMSS>-<8hex>", async () => {
    const home = await mkdtemp(join(tmpdir(), "saaga-home-"));
    const ctx = await createRunContext({
      app: "salesforce",
      subcommand: "init",
      env: { HOME: home },
    });

    expect(ctx.runId).toMatch(RUN_ID_RE);
    expect(ctx.runId.startsWith("salesforce-init-")).toBe(true);
  });

  test("places runDir under $HOME/.saaga/runs/<run-id> by default", async () => {
    const home = await mkdtemp(join(tmpdir(), "saaga-home-"));
    const ctx = await createRunContext({
      app: "myapp",
      subcommand: "update",
      env: { HOME: home },
    });

    const expected = join(home, ".saaga", "runs", ctx.runId);
    expect(ctx.runDir).toBe(expected);
  });

  test("SAAGA_DIR overrides the default location", async () => {
    const custom = await mkdtemp(join(tmpdir(), "saaga-custom-"));
    const ctx = await createRunContext({
      app: "myapp",
      subcommand: "init",
      env: { HOME: "/wont-be-used", SAAGA_DIR: custom },
    });

    expect(ctx.runDir).toBe(join(custom, "runs", ctx.runId));
  });

  test("creates the run directory on disk", async () => {
    const home = await mkdtemp(join(tmpdir(), "saaga-home-"));
    const ctx = await createRunContext({
      app: "myapp",
      subcommand: "init",
      env: { HOME: home },
    });

    const stats = await stat(ctx.runDir);
    expect(stats.isDirectory()).toBe(true);
  });

  test("two contexts produced back-to-back have distinct run ids", async () => {
    const home = await mkdtemp(join(tmpdir(), "saaga-home-"));
    const a = await createRunContext({
      app: "x",
      subcommand: "init",
      env: { HOME: home },
    });
    const b = await createRunContext({
      app: "x",
      subcommand: "init",
      env: { HOME: home },
    });
    expect(a.runId).not.toBe(b.runId);
  });

  test("returns app, app_path and subcommand on the context", async () => {
    const home = await mkdtemp(join(tmpdir(), "saaga-home-"));
    const appDir = await mkdtemp(join(tmpdir(), "saaga-app-"));
    const ctx = await createRunContext({
      app: "salesforce",
      appPath: appDir,
      subcommand: "slice",
      env: { HOME: home },
    });

    expect(ctx.app).toBe("salesforce");
    expect(ctx.appPath).toBe(appDir);
    expect(ctx.subcommand).toBe("slice");
  });
});
