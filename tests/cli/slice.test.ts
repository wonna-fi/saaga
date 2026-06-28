import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  FakeAgent,
  type FakeScenarioValue,
} from "../../src/agent/fake-agent.js";
import { runCli } from "../../src/cli.js";

async function tmpRoot(name: string) {
  return mkdtemp(join(tmpdir(), `saaga-slice-${name}-`));
}

const PLAN_BODY = `---
phases:
  - number: 1
    title: "Phase 1"
---

# Plan body
`;

function verifyScenario(status: "PASS" | "FAIL"): FakeScenarioValue {
  return {
    exitCode: 0,
    effect: async (_opts, prompt) => {
      const m = prompt.match(/Write the verification status to `([^`]+)`/);
      if (!m) throw new Error("status path not found in verify prompt");
      const statusPath = m[1];
      await mkdir(dirname(statusPath), { recursive: true });
      await writeFile(statusPath, status, "utf8");
    },
  };
}

describe("saaga slice", () => {
  test("auto-derives run dir when plan lives under SAAGA_DIR/runs/<id>/plans/", async () => {
    const root = await tmpRoot("derive");
    const saagaDir = join(root, ".saaga");
    const runId = "myapp-init-20260101-120000-abcd1234";
    const planDir = join(saagaDir, "runs", runId, "plans");
    await mkdir(planDir, { recursive: true });
    const planPath = join(planDir, "myapp-init.plan.md");
    await writeFile(planPath, PLAN_BODY, "utf8");

    const fake = new FakeAgent({
      "Document a Plan Slice": { exitCode: 0 },
      "Verify Domain Documentation Slice": verifyScenario("PASS"),
    });

    const exitCode = await runCli(["slice", planPath, "1"], {
      agent: fake,
      env: { SAAGA_DIR: saagaDir },
    });

    expect(exitCode).toBe(0);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0].prompt).toContain("Document a Plan Slice");
    expect(fake.calls[0].prompt).toContain("phase) `1`");

    const expectedRunDir = join(saagaDir, "runs", runId);
    const verifyPrompt = fake.calls[1].prompt;
    expect(verifyPrompt).toContain(
      `${expectedRunDir}/slice-1/review-1.md`,
    );
    expect(verifyPrompt).toContain(
      `${expectedRunDir}/slice-1/status-1.txt`,
    );

    const sliceContents = await readdir(join(expectedRunDir, "slice-1"));
    expect(sliceContents).toContain("status-1.txt");
  });

  test("creates a fresh run-id when plan path is outside SAAGA_DIR/runs/", async () => {
    const root = await tmpRoot("fallback");
    const saagaDir = join(root, ".saaga");
    await mkdir(saagaDir, { recursive: true });
    const externalDir = join(root, "external");
    await mkdir(externalDir, { recursive: true });
    const planPath = join(externalDir, "myplan.plan.md");
    await writeFile(planPath, PLAN_BODY, "utf8");

    const fake = new FakeAgent({
      "Document a Plan Slice": { exitCode: 0 },
      "Verify Domain Documentation Slice": verifyScenario("PASS"),
    });

    const exitCode = await runCli(["slice", planPath, "1"], {
      agent: fake,
      env: { SAAGA_DIR: saagaDir },
    });

    expect(exitCode).toBe(0);
    const verifyPrompt = fake.calls[1].prompt;
    expect(verifyPrompt).toMatch(
      new RegExp(
        `${saagaDir.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}/runs/.+/slice-1/review-1\\.md`,
      ),
    );

    const runsContents = await readdir(join(saagaDir, "runs"));
    expect(runsContents.length).toBe(1);
    expect(runsContents[0]).toMatch(/slice-1/);
  });

  test("rejects non-integer phase number", async () => {
    const root = await tmpRoot("badphase");
    const planPath = join(root, "p.plan.md");
    await writeFile(planPath, PLAN_BODY, "utf8");

    const fake = new FakeAgent({});
    await expect(
      runCli(["slice", planPath, "abc"], {
        agent: fake,
        env: { HOME: root },
      }),
    ).rejects.toThrow(/positive integer/i);
  });

  test("rejects non-integer (decimal) phase number", async () => {
    const root = await tmpRoot("decphase");
    const planPath = join(root, "p.plan.md");
    await writeFile(planPath, PLAN_BODY, "utf8");

    const fake = new FakeAgent({});
    await expect(
      runCli(["slice", planPath, "1.5"], {
        agent: fake,
        env: { HOME: root },
      }),
    ).rejects.toThrow(/positive integer/i);
  });

  test("rejects missing plan file", async () => {
    const root = await tmpRoot("missing");
    const fake = new FakeAgent({});
    await expect(
      runCli(["slice", join(root, "nope.plan.md"), "1"], {
        agent: fake,
        env: { HOME: root },
      }),
    ).rejects.toThrow(/not found/i);
  });
});
