import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  FakeAgent,
  type FakeScenarioValue,
} from "../../src/agent/fake-agent.js";
import { runCli } from "../../src/cli.js";

async function tmpVerifyEnv(name: string) {
  const root = await mkdtemp(join(tmpdir(), "saaga-verify-qu-"));
  const app = join(root, name);
  const home = join(root, "home");
  await mkdir(app);
  await mkdir(home);
  await writeFile(join(app, "src.ts"), "alpha", "utf8");
  return { root, app, home };
}

async function seedQuickUpdateArtifact(app: string, id: string) {
  const dir = join(app, "docs", "metadata", "quick_updates", id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "changes.md"),
    "# Changes Since BASELINE\n\n**Summary**: 1 changed\n",
    "utf8",
  );
  await writeFile(
    join(dir, "summary.md"),
    `---\ngenerated: 2026-06-03T10:00:00Z\nverified: false\ndocs_touched:\n  - docs/concepts/test.md\nconfidence: medium\n---\n\nUpdated test concept.\n`,
    "utf8",
  );
}

function planVerifyScenario(planContent: string): FakeScenarioValue {
  return {
    exitCode: 0,
    effect: async (_opts, prompt) => {
      const m = prompt.match(/write the plan to `([^`]+)`/i);
      if (!m)
        throw new Error("plan path not found in plan-verify prompt");
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

describe("saaga verify-quick-updates", () => {
  test("no artifacts: exits cleanly without invoking the agent", async () => {
    const { app, home } = await tmpVerifyEnv("noop");

    const fake = new FakeAgent({
      "Plan Verification": planVerifyScenario("---\nphases: []\n---\n"),
    });

    const exitCode = await runCli(["verify-quick-updates", app], {
      agent: fake,
      env: { HOME: home },
    });
    expect(exitCode).toBe(0);
    expect(fake.calls).toHaveLength(0);
  });

  test("with artifacts: plan + slice + verify per phase, then removes artifacts", async () => {
    const { app, home } = await tmpVerifyEnv("full");
    await seedQuickUpdateArtifact(app, "run-abc");

    const fake = new FakeAgent({
      "Plan Verification": planVerifyScenario(`---
app: full
type: verify-quick-updates
phases:
  - number: 1
    title: "Verify test concept"
---

# Plan body
`),
      "Document a Plan Slice": { exitCode: 0 },
      "Verify Domain Documentation Slice": verifyScenario(() => "PASS"),
    });

    const exitCode = await runCli(["verify-quick-updates", app], {
      agent: fake,
      env: { HOME: home },
    });
    expect(exitCode).toBe(0);

    // plan + slice + verify = 3
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[0].prompt).toContain("Plan Verification");
    expect(fake.calls[1].prompt).toContain("Document a Plan Slice");
    expect(fake.calls[2].prompt).toContain("Verify Domain Documentation Slice");

    const metaDir = join(app, "docs", "metadata", "quick_updates");
    const remaining = await readdir(metaDir);
    expect(remaining).toEqual([]);
  });

  test("verify FAIL triggers fix, then re-verify", async () => {
    const { app, home } = await tmpVerifyEnv("fixloop");
    await seedQuickUpdateArtifact(app, "run-fix");

    const fake = new FakeAgent({
      "Plan Verification": planVerifyScenario(`---
phases:
  - number: 1
    title: "Fix something"
---

# Plan body
`),
      "Document a Plan Slice": { exitCode: 0 },
      "Verify Domain Documentation Slice": verifyScenario((i) =>
        i >= 2 ? "PASS" : "FAIL",
      ),
      "Fix Documentation Errors": { exitCode: 0 },
    });

    const exitCode = await runCli(["verify-quick-updates", app], {
      agent: fake,
      env: { HOME: home },
    });
    expect(exitCode).toBe(0);

    // plan + slice + verify1(FAIL) + fix + verify2(PASS) = 5
    expect(fake.calls).toHaveLength(5);
    expect(fake.calls[2].prompt).toContain("Verify Domain Documentation Slice");
    expect(fake.calls[3].prompt).toContain("Fix Documentation Errors");
    expect(fake.calls[4].prompt).toContain("Verify Domain Documentation Slice");
  });

  test("multiple artifacts are consolidated and all removed", async () => {
    const { app, home } = await tmpVerifyEnv("multi");
    await seedQuickUpdateArtifact(app, "run-1");
    await seedQuickUpdateArtifact(app, "run-2");

    const fake = new FakeAgent({
      "Plan Verification": planVerifyScenario(`---
phases:
  - number: 1
    title: "Consolidated phase"
---

# Plan body
`),
      "Document a Plan Slice": { exitCode: 0 },
      "Verify Domain Documentation Slice": verifyScenario(() => "PASS"),
    });

    const exitCode = await runCli(["verify-quick-updates", app], {
      agent: fake,
      env: { HOME: home },
    });
    expect(exitCode).toBe(0);

    const metaDir = join(app, "docs", "metadata", "quick_updates");
    const remaining = await readdir(metaDir);
    expect(remaining).toEqual([]);
  });
});
