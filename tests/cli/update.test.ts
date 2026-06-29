import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  FakeAgent,
  type FakeScenarioValue,
} from "../../src/agent/fake-agent.js";
import { runCli } from "../../src/cli.js";
import { DEFAULT_DOCS_DIR } from "../../src/cli/config.js";
import { generateBaseline } from "../../src/scripts/generate-baseline.js";

async function tmpUpdateEnv(name: string) {
  const root = await mkdtemp(join(tmpdir(), "saaga-update-"));
  const app = join(root, name);
  const home = join(root, "home");
  await mkdir(app);
  await mkdir(home);
  await writeFile(join(app, "src.ts"), "alpha", "utf8");
  await writeFile(join(app, "README.md"), "readme", "utf8");
  await generateBaseline({ app_dir: app, docs_dir: DEFAULT_DOCS_DIR }, { cwd: app });
  return { root, app, home };
}

function planUpdateScenario(planContent: string): FakeScenarioValue {
  return {
    exitCode: 0,
    effect: async (_opts, prompt) => {
      const m = prompt.match(/Write the plan to `([^`]+)`/);
      if (!m) throw new Error("plan path not found in plan-update prompt");
      const out = m[1];
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, planContent, "utf8");
    },
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

const ONE_PHASE_UPDATE_PLAN = `---
app: myapp
type: update
phases:
  - number: 1
    title: "New Feature X"
---

# Plan body
`;

describe("saaga update", () => {
  test("zero changes: detect-changes runs, but no plan-update is invoked", async () => {
    const { app, home } = await tmpUpdateEnv("noop");

    const fake = new FakeAgent({
      "Update Domain Documentation": planUpdateScenario(ONE_PHASE_UPDATE_PLAN),
    });

    const exitCode = await runCli(["update", app], {
      agent: fake,
      env: { HOME: home },
    });
    expect(exitCode).toBe(0);
    expect(fake.calls).toHaveLength(0);
  });

  test("changes detected: plan-update runs and receives the changes report path", async () => {
    const { app, home } = await tmpUpdateEnv("change1");
    await writeFile(join(app, "src.ts"), "alpha-modified", "utf8");

    const fake = new FakeAgent({
      "Update Domain Documentation": planUpdateScenario(`---
phases: []
---

## Decision

Non doc-worthy.
`),
    });

    const exitCode = await runCli(["update", app], {
      agent: fake,
      env: { HOME: home },
    });
    expect(exitCode).toBe(0);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].prompt).toContain("Update Domain Documentation");
    const m = fake.calls[0].prompt.match(/changes report is available at `([^`]+)`/);
    expect(m).not.toBeNull();
    const changesPath = m![1];
    const report = await readFile(changesPath, "utf8");
    expect(report).toContain("# Changes Since BASELINE");
    expect(report).toMatch(/`src\.ts`/);
  });

  test("phases execute with verify/fix loop and end with regen-baseline", async () => {
    const { app, home } = await tmpUpdateEnv("multiphase");
    await writeFile(join(app, "src.ts"), "alpha-modified", "utf8");

    const fake = new FakeAgent({
      "Update Domain Documentation": planUpdateScenario(`---
phases:
  - number: 1
    title: "Update X"
  - number: 2
    title: "Update Y"
---

# Plan body
`),
      "Document a Plan Slice": { exitCode: 0 },
      "Verify Domain Documentation Slice": verifyScenario(() => "PASS"),
    });

    const exitCode = await runCli(["update", app], {
      agent: fake,
      env: { HOME: home },
    });
    expect(exitCode).toBe(0);
    // plan-update + (slice + verify) * 2 = 5
    expect(fake.calls).toHaveLength(5);
    expect(fake.calls[0].prompt).toContain("Update Domain Documentation");
    expect(fake.calls[1].prompt).toContain("Document a Plan Slice");
    expect(fake.calls[1].prompt).toContain("phase) `1`");
    expect(fake.calls[2].prompt).toContain("Verify Domain Documentation Slice");
    expect(fake.calls[3].prompt).toContain("Document a Plan Slice");
    expect(fake.calls[3].prompt).toContain("phase) `2`");
    expect(fake.calls[4].prompt).toContain("Verify Domain Documentation Slice");

    const newBaseline = await stat(join(app, DEFAULT_DOCS_DIR, "BASELINE"));
    expect(newBaseline.isFile()).toBe(true);
  });

  test("verify FAIL triggers fix-documentation, then re-verify", async () => {
    const { app, home } = await tmpUpdateEnv("fixloop");
    await writeFile(join(app, "src.ts"), "alpha-modified", "utf8");

    const fake = new FakeAgent({
      "Update Domain Documentation": planUpdateScenario(ONE_PHASE_UPDATE_PLAN),
      "Document a Plan Slice": { exitCode: 0 },
      "Verify Domain Documentation Slice": verifyScenario((i) =>
        i >= 2 ? "PASS" : "FAIL",
      ),
      "Fix Documentation Errors": { exitCode: 0 },
    });

    const exitCode = await runCli(["update", app], {
      agent: fake,
      env: { HOME: home },
    });
    expect(exitCode).toBe(0);

    // plan-update, slice(1), verify1(FAIL), fix1, verify2(PASS) = 5
    expect(fake.calls).toHaveLength(5);
    expect(fake.calls[2].prompt).toContain("Verify Domain Documentation Slice");
    expect(fake.calls[3].prompt).toContain("Fix Documentation Errors");
    expect(fake.calls[4].prompt).toContain("Verify Domain Documentation Slice");
  });
});
