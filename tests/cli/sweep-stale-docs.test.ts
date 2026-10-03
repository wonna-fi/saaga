import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execa } from "execa";
import { describe, expect, test } from "vitest";
import {
  FakeAgent,
  type FakeScenarioValue,
} from "../../src/agent/fake-agent.js";
import { runCli } from "../../src/cli.js";
import { DEFAULT_DOCS_DIR } from "../../src/cli/config.js";
import { writeFormatVersion } from "../../src/docs/format-version.js";

const DOC_REL = join(DEFAULT_DOCS_DIR, "concepts", "test.md");

function testDoc(lastVerified?: string): string {
  return [
    "---",
    "title: Test",
    "type: concept",
    ...(lastVerified ? [`last_verified: ${lastVerified}`] : []),
    "sources:",
    "  - src.ts",
    "---",
    "",
    "# Test",
    "",
    "Describes `src.ts`.",
    "",
  ].join("\n");
}

const CONCEPT_INDEX = [
  "---",
  'title: "Concept Index"',
  "type: index",
  "---",
  "",
  "# Concept Index",
  "",
  "| Name | Description |",
  "|------|-------------|",
  "| [Test](./test.md) | A test concept. |",
  "",
].join("\n");

async function commitAll(dir: string, date: string): Promise<void> {
  const stamp = `${date}T12:00:00`;
  await execa("git", ["add", "-A"], { cwd: dir });
  await execa(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@test", "commit", "-q", "-m", "change"],
    { cwd: dir, env: { GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp } },
  );
}

/**
 * A version-1 corpus with one concept document covering `src.ts`, committed
 * on 2020-01-01. `lastVerified` sets the document's stamp; `git: false`
 * leaves the directory outside version control.
 */
async function tmpSweepEnv(
  name: string,
  opts: { lastVerified?: string; git?: boolean } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "saaga-sweep-"));
  const app = join(root, name);
  await mkdir(join(app, DEFAULT_DOCS_DIR, "concepts"), { recursive: true });
  await writeFile(join(app, ".gitignore"), ".saaga-runs/\n", "utf8");
  await writeFile(join(app, "src.ts"), "alpha", "utf8");
  await writeFormatVersion(join(app, DEFAULT_DOCS_DIR));
  await writeFile(join(app, DOC_REL), testDoc(opts.lastVerified), "utf8");
  await writeFile(join(app, DEFAULT_DOCS_DIR, "concepts", "INDEX.md"), CONCEPT_INDEX, "utf8");
  if (opts.git !== false) {
    await execa("git", ["init", "-q"], { cwd: app });
    await commitAll(app, "2020-01-01");
  }
  return { root, app };
}

const ONE_PHASE_PLAN = `---
app: sweep
type: sweep-stale-docs
phases:
  - number: 1
    title: "Verify test concept"
---

# Plan body
`;

function planScenario(planContent: string): FakeScenarioValue {
  return {
    exitCode: 0,
    effect: async (_opts, prompt) => {
      const m = prompt.match(/write it to `([^`]+)`/i);
      if (!m) throw new Error("plan path not found in plan-sweep prompt");
      await mkdir(dirname(m[1]), { recursive: true });
      await writeFile(m[1], planContent, "utf8");
    },
  };
}

/**
 * Writes the status the round asks for and, on PASS, does what the real
 * verifier's Step 7 does for a document it found clean: stamps
 * `last_verified` with the date the prompt hands it.
 */
function verifyScenario(
  app: string,
  statusFor: (callIndex: number) => "PASS" | "FAIL",
): FakeScenarioValue {
  let calls = 0;
  return {
    exitCode: 0,
    effect: async (_opts, prompt) => {
      calls++;
      const status = statusFor(calls);
      const statusPath = prompt.match(/Write the verification status to `([^`]+)`/)?.[1];
      const date = prompt.match(/Today's date: `([^`]+)`/)?.[1];
      if (!statusPath || !date) throw new Error("status path or date not found in verify prompt");
      await mkdir(dirname(statusPath), { recursive: true });
      await writeFile(statusPath, status, "utf8");
      if (status === "PASS") {
        await writeFile(join(app, DOC_REL), testDoc(date), "utf8");
      }
    },
  };
}

describe("saaga run sweep-stale-docs", () => {
  test("nothing stale: exits cleanly without invoking the agent", async () => {
    const { app } = await tmpSweepEnv("clean", { lastVerified: "2020-01-10" });
    const fake = new FakeAgent({});

    expect(await runCli(["run", "sweep-stale-docs", app], { agent: fake })).toBe(0);
    expect(fake.calls).toHaveLength(0);
  });

  test("a stale document is planned and verified, without a slice rewrite", async () => {
    const { app } = await tmpSweepEnv("stale", { lastVerified: "2020-01-02" });
    await writeFile(join(app, "src.ts"), "beta", "utf8");
    await commitAll(app, "2020-01-05");

    const fake = new FakeAgent({
      "Plan a Staleness Sweep": planScenario(ONE_PHASE_PLAN),
      "Verify Domain Documentation Slice": verifyScenario(app, () => "PASS"),
    });

    expect(await runCli(["run", "sweep-stale-docs", app], { agent: fake })).toBe(0);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0].prompt).toContain("Plan a Staleness Sweep");
    expect(fake.calls[0].prompt).toContain("stale-docs.md");
    expect(fake.calls[1].prompt).toContain("Verify Domain Documentation Slice");
  });

  /**
   * The loop closes: a clean verification stamps the document, and the stamp
   * is what takes it out of the next sweep until its sources change again.
   */
  test("a document verified clean is not selected by the next sweep", async () => {
    const { app } = await tmpSweepEnv("closes");

    const fake = new FakeAgent({
      "Plan a Staleness Sweep": planScenario(ONE_PHASE_PLAN),
      "Verify Domain Documentation Slice": verifyScenario(app, () => "PASS"),
    });
    expect(await runCli(["run", "sweep-stale-docs", app], { agent: fake })).toBe(0);
    expect(fake.calls).toHaveLength(2);
    expect(await readFile(join(app, DOC_REL), "utf8")).toMatch(/last_verified: \d{4}-\d{2}-\d{2}/);

    const second = new FakeAgent({});
    expect(await runCli(["run", "sweep-stale-docs", app], { agent: second })).toBe(0);
    expect(second.calls).toHaveLength(0);
  });

  test("verify FAIL triggers fix, then re-verify", async () => {
    const { app } = await tmpSweepEnv("fixloop");

    const fake = new FakeAgent({
      "Plan a Staleness Sweep": planScenario(ONE_PHASE_PLAN),
      "Verify Domain Documentation Slice": verifyScenario(app, (i) => (i >= 2 ? "PASS" : "FAIL")),
      "Fix Documentation Errors": { exitCode: 0 },
    });

    expect(await runCli(["run", "sweep-stale-docs", app], { agent: fake })).toBe(0);
    // plan + verify1(FAIL) + fix + verify2(PASS) = 4
    expect(fake.calls.map((c) => c.prompt.split("\n")[0])).toEqual([
      "# Plan a Staleness Sweep",
      "# Verify Domain Documentation Slice",
      "# Fix Documentation Errors",
      "# Verify Domain Documentation Slice",
    ]);
  });

  test("an empty plan for a non-empty selection fails the run", async () => {
    const { app } = await tmpSweepEnv("emptyplan");
    const fake = new FakeAgent({
      "Plan a Staleness Sweep": planScenario("---\nphases: []\n---\n"),
    });

    await expect(
      runCli(["run", "sweep-stale-docs", app], { agent: fake }),
    ).rejects.toThrow("'phases' array is empty");
    expect(fake.calls).toHaveLength(1);
  });

  test("outside a git repository: fails before any agent runs", async () => {
    const { app } = await tmpSweepEnv("nogit", { git: false });
    const fake = new FakeAgent({});

    await expect(
      runCli(["run", "sweep-stale-docs", app], { agent: fake }),
    ).rejects.toThrow("is not a git repository");
    expect(fake.calls).toHaveLength(0);
  });
});
