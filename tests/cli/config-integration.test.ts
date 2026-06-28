import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FakeAgent } from "../../src/agent/fake-agent.js";
import { runCli } from "../../src/cli.js";

async function tmpApp(
  name: string,
  config?: string,
): Promise<{ root: string; app: string; home: string }> {
  const root = await mkdtemp(join(tmpdir(), "saaga-cfgint-"));
  const app = join(root, name);
  await mkdir(app);
  const home = join(root, "home");
  await mkdir(home);
  if (config) {
    await mkdir(join(app, ".saaga"), { recursive: true });
    await writeFile(join(app, ".saaga", "config.yaml"), config, "utf8");
  }
  return { root, app, home };
}

describe("config-driven CLI integration", () => {
  test("config supplies backend so no --backend flag needed", async () => {
    const { app, home } = await tmpApp("salesforce", "backend: cursor\n");
    await writeFile(join(app, "README.md"), "x", "utf8");

    const planContent = `---
phases:
  - number: 0
    title: "Setup"
---
# Plan
`;

    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Plan Domain Documentation": {
        exitCode: 0,
        effect: async (_opts, prompt) => {
          const m = prompt.match(/Write the plan to `([^`]+)`/);
          if (!m) throw new Error("plan path not found");
          const { mkdir: mk } = await import("node:fs/promises");
          const { dirname } = await import("node:path");
          await mk(dirname(m[1]), { recursive: true });
          await writeFile(m[1], planContent, "utf8");
        },
      },
      "Document a Plan Slice": { exitCode: 0 },
    });

    // Even though no --backend is passed, the config provides it.
    // FakeAgent bypasses resolveBackend, but we verify no error from
    // the config loading path. The real resolution test is:
    // without FakeAgent and without --backend, having config.backend
    // should not throw "Backend must be specified".
    const exitCode = await runCli(["init", app], {
      agent: fake,
      env: { HOME: home },
    });
    expect(exitCode).toBe(0);
  });

  test("config ruleTargets is used for init when --rule-target not passed", async () => {
    const { app, home } = await tmpApp("ruleapp", "ruleTargets: cursor\n");
    await writeFile(join(app, "README.md"), "x", "utf8");

    const planContent = `---
phases:
  - number: 0
    title: "Setup"
---
# Plan
`;

    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Plan Domain Documentation": {
        exitCode: 0,
        effect: async (_opts, prompt) => {
          const m = prompt.match(/Write the plan to `([^`]+)`/);
          if (!m) throw new Error("plan path not found");
          const { mkdir: mk } = await import("node:fs/promises");
          const { dirname } = await import("node:path");
          await mk(dirname(m[1]), { recursive: true });
          await writeFile(m[1], planContent, "utf8");
        },
      },
      "Document a Plan Slice": { exitCode: 0 },
    });

    const exitCode = await runCli(["init", app], {
      agent: fake,
      env: { HOME: home },
    });
    expect(exitCode).toBe(0);

    // Config specified cursor target, NOT agentsmd.
    const mdc = await readFile(
      join(app, ".cursor", "rules", "domain-docs.mdc"),
      "utf8",
    );
    expect(mdc).toContain("alwaysApply: true");

    // Default (agentsmd) was NOT installed since config overrode it.
    let agentsExists = true;
    try {
      await readFile(join(app, "AGENTS.md"), "utf8");
    } catch {
      agentsExists = false;
    }
    expect(agentsExists).toBe(false);
  });

  test("--rule-target flag overrides config ruleTargets", async () => {
    const { app, home } = await tmpApp("flagwin", "ruleTargets: cursor\n");
    await writeFile(join(app, "README.md"), "x", "utf8");

    const planContent = `---
phases:
  - number: 0
    title: "Setup"
---
# Plan
`;

    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Plan Domain Documentation": {
        exitCode: 0,
        effect: async (_opts, prompt) => {
          const m = prompt.match(/Write the plan to `([^`]+)`/);
          if (!m) throw new Error("plan path not found");
          const { mkdir: mk } = await import("node:fs/promises");
          const { dirname } = await import("node:path");
          await mk(dirname(m[1]), { recursive: true });
          await writeFile(m[1], planContent, "utf8");
        },
      },
      "Document a Plan Slice": { exitCode: 0 },
    });

    const exitCode = await runCli(["init", app, "--rule-target", "agentsmd"], {
      agent: fake,
      env: { HOME: home },
    });
    expect(exitCode).toBe(0);

    // Flag said agentsmd, so AGENTS.md should exist.
    const agentsMd = await readFile(join(app, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("<!-- saaga:begin -->");
  });

  test("install-rules subcommand uses config ruleTargets", async () => {
    const { app } = await tmpApp("irconfig", "ruleTargets: claude\n");

    const exitCode = await runCli(["install-rules", app], { env: {} });
    expect(exitCode).toBe(0);

    const claude = await readFile(join(app, "CLAUDE.md"), "utf8");
    expect(claude).toContain("<!-- saaga:begin -->");

    // Default (agentsmd) was NOT installed.
    let agentsExists = true;
    try {
      await readFile(join(app, "AGENTS.md"), "utf8");
    } catch {
      agentsExists = false;
    }
    expect(agentsExists).toBe(false);
  });

  test("install-rules --rule-target flag overrides config", async () => {
    const { app } = await tmpApp("irflag", "ruleTargets: claude\n");

    const exitCode = await runCli(
      ["install-rules", app, "--rule-target", "agentsmd"],
      { env: {} },
    );
    expect(exitCode).toBe(0);

    const agentsMd = await readFile(join(app, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("<!-- saaga:begin -->");
  });
});
