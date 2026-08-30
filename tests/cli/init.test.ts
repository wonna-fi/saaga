import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { Writable } from "node:stream";
import { describe, expect, test } from "vitest";
import {
  FakeAgent,
  type FakeScenarioValue,
} from "../../src/agent/fake-agent.js";
import { runCli } from "../../src/cli.js";
import { DEFAULT_DOCS_DIR } from "../../src/cli/config.js";
import {
  CURRENT_FORMAT_VERSION,
  readFormatVersion,
  writeFormatVersion,
} from "../../src/docs/format-version.js";

class StringWritable extends Writable {
  private chunks: string[] = [];
  _write(chunk: Buffer, _enc: string, cb: () => void): void {
    this.chunks.push(chunk.toString());
    cb();
  }
  get text(): string {
    return this.chunks.join("");
  }
}

/** App dir with a single file on disk. */
async function tmpAppEnv(name: string) {
  const root = await mkdtemp(join(tmpdir(), "saaga-test-"));
  const app = join(root, name);
  await mkdir(app);
  await writeFile(join(app, "README.md"), "x", "utf8");
  return { root, app };
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

describe("saaga run init", () => {
  test("phase-0-only plan: architecture, plan-init, slice-doc(0), install-rules, baseline", async () => {
    const { app } = await tmpAppEnv("salesforce");
    const planScenario = planInitScenario(SINGLE_PHASE_PLAN);

    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planScenario.scenario,
      "Document a Plan Slice": { exitCode: 0 },
    });

    const exitCode = await runCli(["run", "init", app], {
      agent: fake,
    });

    expect(exitCode).toBe(0);
    // architecture, plan-init, verify-architecture(PASS), slice-doc(0)
    // (no foreach body); install-rules is a script step, not an agent call.
    expect(fake.calls).toHaveLength(4);
    expect(fake.calls[0].prompt).toContain("Document the Architecture");
    expect(fake.calls[1].prompt).toContain("Plan Domain Documentation");
    expect(fake.calls[2].prompt).toContain("Verify the Architecture Document");
    expect(fake.calls[3].prompt).toContain("Document a Plan Slice");
    expect(fake.calls[3].prompt).toContain("phase) `0`");

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
    expect(path.startsWith(join(app, ".saaga-runs"))).toBe(true);
    expect(path.endsWith("/plans/salesforce-init.plan.md")).toBe(true);
  });

  test("fails when plan-init does not produce the expected file", async () => {
    const { app } = await tmpAppEnv("noplan");
    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": { exitCode: 0 },
    });

    await expect(
      runCli(["run", "init", app], { agent: fake }),
    ).rejects.toThrow(/expect_file/);
  });

  test("foreach skips phase 0 and runs slice-doc + verify for non-zero phases", async () => {
    const { app } = await tmpAppEnv("acme");

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
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planInitScenario(planContent).scenario,
      "Document a Plan Slice": { exitCode: 0 },
      "Verify Domain Documentation Slice": verifyScenario(() => "PASS"),
    });

    const exitCode = await runCli(["run", "init", app], {
      agent: fake,
    });

    expect(exitCode).toBe(0);
    // architecture + plan-init + verify-architecture(PASS) + slice-doc(0)
    // + per non-zero phase: slice-doc + verify(PASS) -> 2 phases * 2 = 4
    expect(fake.calls).toHaveLength(4 + 4);

    expect(fake.calls[0].prompt).toContain("Document the Architecture");
    expect(fake.calls[1].prompt).toContain("Plan Domain Documentation");
    expect(fake.calls[2].prompt).toContain("Verify the Architecture Document");
    expect(fake.calls[3].prompt).toContain("Document a Plan Slice");
    expect(fake.calls[3].prompt).toContain("phase) `0`");
    expect(fake.calls[4].prompt).toContain("Document a Plan Slice");
    expect(fake.calls[4].prompt).toContain("phase) `1`");
    expect(fake.calls[5].prompt).toContain("Verify Domain Documentation Slice");
    expect(fake.calls[6].prompt).toContain("Document a Plan Slice");
    expect(fake.calls[6].prompt).toContain("phase) `2`");
    expect(fake.calls[7].prompt).toContain("Verify Domain Documentation Slice");
  });

  test("verify/fix loop: FAIL then fix then verify(PASS), then no third iteration", async () => {
    const { app } = await tmpAppEnv("verifyfix");

    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation":
        planInitScenario(ONE_NONZERO_PHASE_PLAN).scenario,
      "Document a Plan Slice": { exitCode: 0 },
      "Verify Domain Documentation Slice": verifyScenario((i) =>
        i >= 2 ? "PASS" : "FAIL",
      ),
      "Fix Documentation Errors": { exitCode: 0 },
    });

    const exitCode = await runCli(["run", "init", app], {
      agent: fake,
    });

    expect(exitCode).toBe(0);

    // architecture, plan-init, verify-architecture(PASS), slice-doc(0),
    // slice-doc(1), verify1(FAIL), fix1, verify2(PASS) = 8
    expect(fake.calls).toHaveLength(8);
    expect(fake.calls[4].prompt).toContain("Document a Plan Slice");
    expect(fake.calls[4].prompt).toContain("phase) `1`");
    expect(fake.calls[5].prompt).toContain("Verify Domain Documentation Slice");
    expect(fake.calls[6].prompt).toContain("Fix Documentation Errors");
    expect(fake.calls[7].prompt).toContain("Verify Domain Documentation Slice");

    const fixCalls = fake.calls.filter((c) =>
      c.prompt.includes("Fix Documentation Errors"),
    );
    expect(fixCalls).toHaveLength(1);
    const verifyCalls = fake.calls.filter((c) =>
      c.prompt.includes("Verify Domain Documentation Slice"),
    );
    expect(verifyCalls).toHaveLength(2);
  });

  /**
   * Task 6. ARCHITECTURE.md is written before the plan exists and outside the
   * per-phase verify/fix loop, so nothing checked it and a 689-line document
   * ignoring its own prompt's rules went unnoticed for the corpus's whole life.
   * It now gets a loop of its own, after parse-plan so the plan can carry its
   * budget and its ownership declaration.
   */
  test("architecture verify/fix loop: FAIL then fix then verify(PASS)", async () => {
    const { app } = await tmpAppEnv("archfix");

    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Plan Domain Documentation": planInitScenario(SINGLE_PHASE_PLAN).scenario,
      "Verify the Architecture Document": verifyScenario((i) =>
        i >= 2 ? "PASS" : "FAIL",
      ),
      "Fix Documentation Errors": { exitCode: 0 },
      "Document a Plan Slice": { exitCode: 0 },
    });

    const exitCode = await runCli(["run", "init", app], { agent: fake });

    expect(exitCode).toBe(0);

    // architecture, plan-init, verify1(FAIL), fix1, verify2(PASS), slice-doc(0)
    expect(fake.calls).toHaveLength(6);
    expect(fake.calls[2].prompt).toContain("Verify the Architecture Document");
    expect(fake.calls[3].prompt).toContain("Fix Documentation Errors");
    expect(fake.calls[4].prompt).toContain("Verify the Architecture Document");
    expect(fake.calls[5].prompt).toContain("Document a Plan Slice");

    // The fixer is shared with the per-phase loop, so it is told which slice it
    // is fixing. `architecture` is the sentinel that means "no phase definition;
    // the slice is ARCHITECTURE.md, and the plan section is Architecture Document".
    expect(fake.calls[3].prompt).toContain("Phase/slice number: `architecture`");
    expect(fake.calls[3].prompt).toContain(
      "When the phase/slice number given above is `architecture`",
    );

    // Each iteration gets its own report and status file, so a fix never reads
    // the report it was already applied to.
    const runDirs = await readdir(join(app, ".saaga-runs"));
    const archDir = join(app, ".saaga-runs", runDirs[0], "architecture");
    expect((await readdir(archDir)).sort()).toEqual([
      "status-1.txt",
      "status-2.txt",
    ]);
  });

  // A top-level loop used to contribute no phase line at all, so this pass ran
  // in silence: `logger.detail` only prints under --verbose, and every other
  // agent step in every flow announces itself. Minutes of nothing reads as a
  // hang, so the loop is one phase and its iterations report under it.
  test("the architecture pass announces itself like every other phase", async () => {
    const { app } = await tmpAppEnv("archphase");

    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Plan Domain Documentation": planInitScenario(SINGLE_PHASE_PLAN).scenario,
      "Verify the Architecture Document": verifyScenario((i) =>
        i >= 2 ? "PASS" : "FAIL",
      ),
      "Fix Documentation Errors": { exitCode: 0 },
      "Document a Plan Slice": { exitCode: 0 },
    });

    const err = new StringWritable();
    const exitCode = await runCli(["run", "init", app], { agent: fake, stderr: err });
    expect(exitCode).toBe(0);

    expect(err.text).toContain("verifying architecture (iteration 1/3)");
    expect(err.text).toContain("fixing architecture (iteration 1/3)");
    expect(err.text).toContain("verifying architecture (iteration 2/3)");

    // Retrying must not inflate the total: all three lines sit on one phase
    // number, and the run still ends on its last phase.
    const phases = [...err.text.matchAll(/Phase (\d+)\/(\d+): (?:verifying|fixing) architecture/g)];
    expect(phases.length).toBe(3);
    expect(new Set(phases.map((m) => m[1])).size).toBe(1);
    expect(new Set(phases.map((m) => m[2])).size).toBe(1);
  });

  test("architecture loop gives up after three failed verifications", async () => {
    const { app } = await tmpAppEnv("archstuck");

    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Plan Domain Documentation": planInitScenario(SINGLE_PHASE_PLAN).scenario,
      "Verify the Architecture Document": verifyScenario(() => "FAIL"),
      "Fix Documentation Errors": { exitCode: 0 },
      "Document a Plan Slice": { exitCode: 0 },
    });

    // Exhausting the loop is not an error: the corpus is on disk and the reports
    // say what is still wrong. The run continues, as the per-phase loop does.
    const exitCode = await runCli(["run", "init", app], { agent: fake });
    expect(exitCode).toBe(0);

    const verifies = fake.calls.filter((c) =>
      c.prompt.includes("Verify the Architecture Document"),
    );
    const fixes = fake.calls.filter((c) =>
      c.prompt.includes("Fix Documentation Errors"),
    );
    expect(verifies).toHaveLength(3);
    expect(fixes).toHaveLength(3);
  });

  test("P15 full parity: ordering + docs/BASELINE exists at the end", async () => {
    const { app } = await tmpAppEnv("parity");

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
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planInitScenario(planContent).scenario,
      "Document a Plan Slice": { exitCode: 0 },
      "Verify Domain Documentation Slice": verifyScenario(() => "PASS"),
    });

    const exitCode = await runCli(["run", "init", app], {
      agent: fake,
    });

    expect(exitCode).toBe(0);

    // Strict order check (split tolerates CRLF in prompt files).
    const sequence = fake.calls.map((c) => c.prompt.split(/\r?\n/)[0]);
    expect(sequence).toEqual([
      "# Document the Architecture of an Application",
      "# Plan Domain Documentation for an Application",
      "# Verify the Architecture Document", // PASS, exits after one iteration
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
    const { app } = await tmpAppEnv("flagged");
    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planInitScenario(SINGLE_PHASE_PLAN).scenario,
      "Document a Plan Slice": { exitCode: 0 },
    });

    const exitCode = await runCli(
      ["run", "init", app, "--rule-targets", "cursor,copilot"],
      { agent: fake },
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
    const { app } = await tmpAppEnv("badflag");
    const fake = new FakeAgent({});

    await expect(
      runCli(["run", "init", app, "--rule-targets", "bogus"], {
        agent: fake,
      }),
    ).rejects.toThrow(/invalid rule target 'bogus'/);

    expect(fake.calls).toHaveLength(0);
  });

  test("empty/whitespace --rule-targets fails fast before any agent call", async () => {
    const { app } = await tmpAppEnv("emptyflag");
    const fake = new FakeAgent({});

    await expect(
      runCli(["run", "init", app, "--rule-targets", "   "], {
        agent: fake,
      }),
    ).rejects.toThrow(/no rule target specified/);

    expect(fake.calls).toHaveLength(0);
  });

  test(".saagarules content is appended to every agent prompt", async () => {
    const { app } = await tmpAppEnv("withrules");
    await writeFile(
      join(app, ".saagarules"),
      "\n  Always document error handling.\n\n",
      "utf8",
    );

    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planInitScenario(SINGLE_PHASE_PLAN).scenario,
      "Document a Plan Slice": { exitCode: 0 },
    });

    const exitCode = await runCli(["run", "init", app], { agent: fake });
    expect(exitCode).toBe(0);

    for (const call of fake.calls) {
      expect(call.prompt).toContain("Always document error handling.");
      expect(call.prompt).toContain(".saagarules");
      expect(call.prompt).toContain("HIGH PRIORITY");
    }

    // First line of each prompt still matches the original template heading.
    expect(fake.calls[0].prompt.split(/\r?\n/)[0]).toBe(
      "# Document the Architecture of an Application",
    );
  });
});

describe("saaga run init > prompt archive", () => {
  test("writes every rendered agent prompt into the run directory", async () => {
    const { app } = await tmpAppEnv("salesforce");
    const planScenario = planInitScenario(SINGLE_PHASE_PLAN);

    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planScenario.scenario,
      "Document a Plan Slice": { exitCode: 0 },
    });

    const exitCode = await runCli(["run", "init", app], { agent: fake });
    expect(exitCode).toBe(0);

    const runDirs = await readdir(join(app, ".saaga-runs"));
    expect(runDirs).toHaveLength(1);
    const promptsDir = join(app, ".saaga-runs", runDirs[0], "prompts");
    const archived = (await readdir(promptsDir)).sort();

    // One archived file per agent call, in call order, byte-identical to
    // what the agent received.
    expect(archived).toEqual([
      "01-document-architecture.md",
      "02-plan-init.md",
      "03-verify-architecture-iter1.md",
      "04-slice-doc-phase0.md",
    ]);
    for (const [i, call] of fake.calls.entries()) {
      expect(await readFile(join(promptsDir, archived[i]), "utf8")).toBe(
        call.prompt,
      );
    }
  });
});

describe("saaga run init: corpus format version", () => {
  test("a successful run stamps the corpus with the format version", async () => {
    const { app } = await tmpAppEnv("stamped");
    const planScenario = planInitScenario(SINGLE_PHASE_PLAN);

    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planScenario.scenario,
      "Document a Plan Slice": { exitCode: 0 },
    });

    const exitCode = await runCli(["run", "init", app], { agent: fake });

    expect(exitCode).toBe(0);
    expect(await readFormatVersion(join(app, DEFAULT_DOCS_DIR))).toEqual({
      state: "corpus",
      version: CURRENT_FORMAT_VERSION,
    });
  });

  test("refuses to overwrite an existing corpus", async () => {
    const { app } = await tmpAppEnv("existing");
    await mkdir(join(app, DEFAULT_DOCS_DIR), { recursive: true });
    await writeFile(
      join(app, DEFAULT_DOCS_DIR, "ARCHITECTURE.md"),
      "# Existing\n",
      "utf8",
    );
    const fake = new FakeAgent({});

    await expect(runCli(["run", "init", app], { agent: fake })).rejects.toThrow(
      /does not overwrite an existing corpus/,
    );
    // The gate runs before anything else, so no agent was paid for.
    expect(fake.calls).toHaveLength(0);
  });

  test("refuses even when the existing corpus is at the current version", async () => {
    const { app } = await tmpAppEnv("current");
    await writeFormatVersion(join(app, DEFAULT_DOCS_DIR));
    const fake = new FakeAgent({});

    await expect(runCli(["run", "init", app], { agent: fake })).rejects.toThrow(
      /delete saaga-docs/,
    );
  });

  test("the verify prompt receives a real ISO date, not a placeholder", async () => {
    const { app } = await tmpAppEnv("isodate");
    const planScenario = planInitScenario(ONE_NONZERO_PHASE_PLAN);
    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planScenario.scenario,
      "Document a Plan Slice": { exitCode: 0 },
      "Verify Domain Documentation Slice": verifyScenario(() => "PASS"),
    });

    const exitCode = await runCli(["run", "init", app], { agent: fake });
    expect(exitCode).toBe(0);

    const verifyPrompt = fake.calls.find((c) =>
      c.prompt.includes("Verify Domain Documentation Slice"),
    )?.prompt;
    expect(verifyPrompt).toBeDefined();

    // The date reaches the prompt as a real YYYY-MM-DD value. An unresolved
    // `${iso_date}` or the run-id's YYYYMMDD form would both produce a
    // `last_verified` the frontmatter parser rejects.
    const line = verifyPrompt!
      .split("\n")
      .find((l) => l.includes("Today's date"));
    expect(line).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(line).not.toContain("iso_date");
  });

  test("generates the navigation layer and the corpus validates clean", async () => {
    const { app } = await tmpAppEnv("navdemo");
    const docs = join(app, DEFAULT_DOCS_DIR);

    // The other init tests write no documentation at all, so this is the only
    // one where generate-navigation has an INDEX to work from.
    const writeCorpus: FakeScenarioValue = {
      exitCode: 0,
      effect: async () => {
        await mkdir(join(docs, "concepts"), { recursive: true });
        await writeFile(join(docs, "ARCHITECTURE.md"), "# Architecture — navdemo\n", "utf8");
        await writeFile(
          join(docs, "concepts", "INDEX.md"),
          [
            "# Concepts Index",
            "",
            "| Name | Description |",
            "|------|-------------|",
            "| [Alpha](./alpha.md) | the first thing |",
            "| [Beta](./beta.md) | the second thing |",
            "",
          ].join("\n"),
          "utf8",
        );
        await writeFile(join(docs, "concepts", "alpha.md"), "# Alpha\n", "utf8");
        await writeFile(join(docs, "concepts", "beta.md"), "# Beta\n", "utf8");
      },
    };

    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planInitScenario(SINGLE_PHASE_PLAN).scenario,
      "Document a Plan Slice": writeCorpus,
    });

    expect(await runCli(["run", "init", app], { agent: fake })).toBe(0);

    const readme = await readFile(join(docs, "README.md"), "utf8");
    expect(readme).toContain("](./ARCHITECTURE.md)");
    expect(readme).toContain("](./GLOSSARY.md)");
    expect(readme).toContain("](./concepts/INDEX.md)");

    const glossary = await readFile(join(docs, "GLOSSARY.md"), "utf8");
    expect(glossary).toContain("- [Alpha](./concepts/alpha.md) — the first thing");
    expect(glossary).toContain("- [Beta](./concepts/beta.md) — the second thing");

    // validate-docs runs after generate-navigation, so its report is the proof
    // that the generated README de-orphaned ARCHITECTURE.md.
    const runs = await readdir(join(app, ".saaga-runs"));
    expect(runs).toHaveLength(1);
    const report = await readFile(
      join(app, ".saaga-runs", runs[0], "doc-validation.md"),
      "utf8",
    );
    expect(report).toContain(
      "0 broken links, 0 invalid diagrams, 0 orphans, 0 over-cap conventions.",
    );
  });
});
