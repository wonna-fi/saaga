import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runCli } from "../../src/cli.js";

async function tmpApp(name = "myapp"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "saaga-cli-install-"));
  const app = join(root, name);
  await mkdir(app);
  return app;
}

describe("saaga install-rules", () => {
  test("installs the default AGENTS.md rules without backend env vars", async () => {
    const app = await tmpApp();

    // No agent option, no config, no credentials: must still work.
    const exitCode = await runCli(["install-rules", app], { env: {} });
    expect(exitCode).toBe(0);

    const agentsMd = await readFile(join(app, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("<!-- saaga:begin -->");
    expect(agentsMd).toContain("### Domain Documentation (myapp)");
    expect(agentsMd).toContain("docs/concepts/INDEX.md");
  });

  test("honors --rule-targets lists", async () => {
    const app = await tmpApp();

    const exitCode = await runCli(
      ["install-rules", app, "--rule-targets", "cursor,claude"],
      { env: {} },
    );
    expect(exitCode).toBe(0);

    const mdc = await readFile(
      join(app, ".cursor", "rules", "domain-docs.mdc"),
      "utf8",
    );
    expect(mdc).toContain("alwaysApply: true");

    const claude = await readFile(join(app, "CLAUDE.md"), "utf8");
    expect(claude).toContain("<!-- saaga:begin -->");

    // Non-requested targets are untouched.
    await expect(stat(join(app, "AGENTS.md"))).rejects.toThrow();
  });

  test("is idempotent and preserves surrounding content", async () => {
    const app = await tmpApp();
    await writeFile(join(app, "AGENTS.md"), "# Existing\n", "utf8");

    await runCli(["install-rules", app], { env: {} });
    const first = await readFile(join(app, "AGENTS.md"), "utf8");

    await runCli(["install-rules", app], { env: {} });
    const second = await readFile(join(app, "AGENTS.md"), "utf8");

    expect(first.startsWith("# Existing")).toBe(true);
    expect(second).toBe(first);
  });

  test("fails on invalid targets", async () => {
    const app = await tmpApp();
    await expect(
      runCli(["install-rules", app, "--rule-targets", "bogus"], { env: {} }),
    ).rejects.toThrow(/invalid rule target 'bogus'/);
  });

  test("fails on a missing directory", async () => {
    await expect(
      runCli(["install-rules", "/nonexistent/path"], { env: {} }),
    ).rejects.toThrow(/Directory not found/);
  });
});
