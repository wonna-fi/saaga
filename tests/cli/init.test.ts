import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  FakeAgent,
  type FakeScenarioValue,
} from "../../src/agent/fake-agent.js";
import { runCli } from "../../src/cli.js";

/** App dir with a single file on disk. */
async function tmpAppEnv(name: string) {
  const root = await mkdtemp(join(tmpdir(), "saaga-test-"));
  const app = join(root, name);
  await mkdir(app);
  const home = join(root, "home");
  await mkdir(home);
  await writeFile(join(app, "README.md"), "x", "utf8");
  return { root, app, home };
}

function planInitScenario(planContent: string): {
  scenario: FakeScenarioValue;
  getPath: () => string | null;
} {
  let captured: string | null = null;
  return {
    scenario: {
      exitCode: 0,
      effect: async (_opts, prompt) => {
        const m = prompt.match(/Write the plan to `([^`]+)`/);
        if (!m) throw new Error("plan path not found in plan-init prompt");
        captured = m[1];
        await mkdir(dirname(captured), { recursive: true });
        await writeFile(captured, planContent, "utf8");
      },
    },
    getPath: () => captured,
  };
}

function verifyScenario(
  statusFor: (callIndex: number) => "PASS" | "FAIL",
): FakeScenarioValue {
  let calls = 0;
  return {
    exitCode: 0,
    effect: async (_opts, prompt) => {
      calls++;
      const status = statusFor(calls);
      const m = prompt.match(/Write the verification status to `([^`]+)`/);
      if (!m) throw new Error("status path not found in verify prompt");
      const statusPath = m[1];
      await mkdir(dirname(statusPath), { recursive: true });
      await writeFile(statusPath, status, "utf8");
    },
  };
}

const SINGLE_PHASE_PLAN = `---
phases:
  - number: 0
    title: "Setup Structure"
---

# Plan body
`;

const ONE_NONZERO_PHASE_PLAN = `---
phases:
  - number: 0
    title: "Setup Structure"
  - number: 1
    title: "Core Concepts"
---

# Plan body
`;

describe("saaga init", () => {
  test("phase-0-only plan: architecture, plan-init, slice-doc(0), install-rules, baseline", async () => {
    const { app, home } = await tmpAppEnv("salesforce");
    const planScenario = planInitScenario(SINGLE_PHASE_PLAN);

    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Plan Domain Documentation": planScenario.scenario,
      "Document a Plan Slice": { exitCode: 0 },
    });

    const exitCode = await runCli(["init", app], {
      agent: fake,
      env: { HOME: home },
    });

    expect(exitCode).toBe(0);
    // architecture, plan-init, slice-doc(0) (no foreach body);
    // install-rules is a script step, not an agent call.
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[0].prompt).toContain("Document the Architecture");
    expect(fake.calls[1].prompt).toContain("Plan Domain Documentation");
    expect(fake.calls[2].prompt).toContain("Document a Plan Slice");
    expect(fake.calls[2].prompt).toContain("phase) `0`");

    // install-rules wrote the default AGENTS.md rules.
    const agentsMd = await readFile(join(app, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("<!-- saaga:begin -->");
    expect(agentsMd).toContain("### Domain Documentation (salesforce)");
    expect(agentsMd).toContain("saaga-docs/concepts/INDEX.md");

    // generate-baseline is a script step, so it doesn't show up in agent calls
    // but it should have produced saaga-docs/BASELINE.
    const stats = await stat(join(app, "saaga-docs", "BASELINE"));
    expect(stats.isFile()).toBe(true);

    const planPath = planScenario.getPath();
    expect(planPath).not.toBeNull();
    const path = planPath as string;
    expect(isAbsolute(path)).toBe(true);
    expect(path.startsWith(join(home, ".saaga", "runs"))).toBe(true);
    expect(path.endsWith("/plans/salesforce-init.plan.md")).toBe(true);
  });

  test("fails when plan-init does not produce the expected file", async () => {
    const { app, home } = await tmpAppEnv("noplan");
    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Plan Domain Documentation": { exitCode: 0 },
    });

    await expect(
      runCli(["init", app], { agent: fake, env: { HOME: home } }),
    ).rejects.toThrow(/expect_file/);
  });

  test("foreach skips phase 0 and runs slice-doc + verify for non-zero phases", async () => {
    const { app, home } = await tmpAppEnv("acme");

    const planContent = `---
phases:
  - number: 0
    title: "Setup Structure"
  - number: 1
    title: "Core Concepts"
  - number: 2
    title: "Authentication"
---

# Plan body
`;

    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Plan Domain Documentation": planInitScenario(planContent).scenario,
      "Document a Plan Slice": { exitCode: 0 },
      "Verify Domain Documentation Slice": verifyScenario(() => "PASS"),
    });

    const exitCode = await runCli(["init", app], {
      agent: fake,
      env: { HOME: home },
    });

    expect(exitCode).toBe(0);
    // architecture + plan-init + slice-doc(0)
    // + per non-zero phase: slice-doc + verify(PASS) -> 2 phases * 2 = 4
    expect(fake.calls).toHaveLength(3 + 4);

    expect(fake.calls[0].prompt).toContain("Document the Architecture");
    expect(fake.calls[1].prompt).toContain("Plan Domain Documentation");
    expect(fake.calls[2].prompt).toContain("Document a Plan Slice");
    expect(fake.calls[2].prompt).toContain("phase) `0`");
    expect(fake.calls[3].prompt).toContain("Document a Plan Slice");
    expect(fake.calls[3].prompt).toContain("phase) `1`");
    expect(fake.calls[4].prompt).toContain("Verify Domain Documentation Slice");
    expect(fake.calls[5].prompt).toContain("Document a Plan Slice");
    expect(fake.calls[5].prompt).toContain("phase) `2`");
    expect(fake.calls[6].prompt).toContain("Verify Domain Documentation Slice");
  });

  test("verify/fix loop: FAIL then fix then verify(PASS), then no third iteration", async () => {
    const { app, home } = await tmpAppEnv("verifyfix");

    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Plan Domain Documentation":
        planInitScenario(ONE_NONZERO_PHASE_PLAN).scenario,
      "Document a Plan Slice": { exitCode: 0 },
      "Verify Domain Documentation Slice": verifyScenario((i) =>
        i >= 2 ? "PASS" : "FAIL",
      ),
      "Fix Documentation Errors": { exitCode: 0 },
    });

    const exitCode = await runCli(["init", app], {
      agent: fake,
      env: { HOME: home },
    });

    expect(exitCode).toBe(0);

    // architecture, plan-init, slice-doc(0),
    // slice-doc(1), verify1(FAIL), fix1, verify2(PASS) = 7
    expect(fake.calls).toHaveLength(7);
    expect(fake.calls[3].prompt).toContain("Document a Plan Slice");
    expect(fake.calls[3].prompt).toContain("phase) `1`");
    expect(fake.calls[4].prompt).toContain("Verify Domain Documentation Slice");
    expect(fake.calls[5].prompt).toContain("Fix Documentation Errors");
    expect(fake.calls[6].prompt).toContain("Verify Domain Documentation Slice");

    const fixCalls = fake.calls.filter((c) =>
      c.prompt.includes("Fix Documentation Errors"),
    );
    expect(fixCalls).toHaveLength(1);
    const verifyCalls = fake.calls.filter((c) =>
      c.prompt.includes("Verify Domain Documentation Slice"),
    );
    expect(verifyCalls).toHaveLength(2);
  });

  test("P15 full parity: ordering + docs/BASELINE exists at the end", async () => {
    const { app, home } = await tmpAppEnv("parity");

    const planContent = `---
phases:
  - number: 0
    title: "Setup Structure"
  - number: 1
    title: "Domain"
---

# Plan body
`;

    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Plan Domain Documentation": planInitScenario(planContent).scenario,
      "Document a Plan Slice": { exitCode: 0 },
      "Verify Domain Documentation Slice": verifyScenario(() => "PASS"),
    });

    const exitCode = await runCli(["init", app], {
      agent: fake,
      env: { HOME: home },
    });

    expect(exitCode).toBe(0);

    // Strict order check (split tolerates CRLF in prompt files).
    const sequence = fake.calls.map((c) => c.prompt.split(/\r?\n/)[0]);
    expect(sequence).toEqual([
      "# Document the Architecture of an Application",
      "# Plan Domain Documentation for an Application",
      "# Document a Plan Slice", // phase 0 explicit
      "# Document a Plan Slice", // foreach phase 1
      "# Verify Domain Documentation Slice", // verify phase 1 (PASS, exits)
    ]);

    // The install-rules script step ran between slice-doc(0) and the
    // foreach: the default AGENTS.md rules are present.
    const agentsMd = await readFile(join(app, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("<!-- saaga:begin -->");

    const baseline = await stat(join(app, "saaga-docs", "BASELINE"));
    expect(baseline.isFile()).toBe(true);
  });

  test("--rule-targets flag reaches the install step", async () => {
    const { app, home } = await tmpAppEnv("flagged");
    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Plan Domain Documentation": planInitScenario(SINGLE_PHASE_PLAN).scenario,
      "Document a Plan Slice": { exitCode: 0 },
    });

    const exitCode = await runCli(
      ["init", app, "--rule-targets", "cursor,copilot"],
      { agent: fake, env: { HOME: home } },
    );

    expect(exitCode).toBe(0);

    const mdc = await readFile(
      join(app, ".cursor", "rules", "domain-docs.mdc"),
      "utf8",
    );
    expect(mdc).toContain("alwaysApply: true");
    const copilot = await readFile(
      join(app, ".github", "instructions", "domain-docs.instructions.md"),
      "utf8",
    );
    expect(copilot).toContain('applyTo: "**"');

    // Default was overridden.
    await expect(stat(join(app, "AGENTS.md"))).rejects.toThrow();
  });

  test("invalid --rule-targets fails fast before any agent call", async () => {
    const { app, home } = await tmpAppEnv("badflag");
    const fake = new FakeAgent({});

    await expect(
      runCli(["init", app, "--rule-targets", "bogus"], {
        agent: fake,
        env: { HOME: home },
      }),
    ).rejects.toThrow(/invalid rule target 'bogus'/);

    expect(fake.calls).toHaveLength(0);
  });

  test("empty/whitespace --rule-targets fails fast before any agent call", async () => {
    const { app, home } = await tmpAppEnv("emptyflag");
    const fake = new FakeAgent({});

    await expect(
      runCli(["init", app, "--rule-targets", "   "], {
        agent: fake,
        env: { HOME: home },
      }),
    ).rejects.toThrow(/no rule target specified/);

    expect(fake.calls).toHaveLength(0);
  });
});
