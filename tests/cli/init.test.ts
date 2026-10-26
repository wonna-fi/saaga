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
import { parsePlannedDocs } from "../../src/docs/corpus-budget.js";
import {
  CURRENT_FORMAT_VERSION,
  readFormatVersion,
  writeFormatVersion,
} from "../../src/docs/format-version.js";
import { parseDoc } from "../../src/docs/frontmatter.js";

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

/**
 * The architecture writer, doing the one thing `check-planned-docs` holds it
 * to: leaving `ARCHITECTURE.md` on disk. A fake that exits 0 and writes
 * nothing is what issue #73 is about, so it is no longer the default here.
 */
function architectureScenario(): FakeScenarioValue {
  return {
    exitCode: 0,
    effect: async (opts) => {
      const docs = join(opts.cwd, DEFAULT_DOCS_DIR);
      await mkdir(docs, { recursive: true });
      await writeFile(join(docs, "ARCHITECTURE.md"), "# Architecture\n", "utf8");
    },
  };
}

/**
 * A slice writer that actually writes: it reads the plan the prompt names and
 * creates every document the roster parser finds in it, a superset of what
 * the gate checks, and the INDEX.md of every folder it writes into.
 */
function sliceScenario(): FakeScenarioValue {
  return {
    exitCode: 0,
    effect: async (opts, prompt) => {
      const m = prompt.match(/The path to the documentation plan: `([^`]+)`/);
      if (!m) throw new Error("plan path not found in slice-doc prompt");
      const planText = await readFile(m[1], "utf8");
      const docs = join(opts.cwd, DEFAULT_DOCS_DIR);

      for (const doc of parsePlannedDocs(planText, DEFAULT_DOCS_DIR).docs) {
        await writeDocs(docs, [doc.path]);
      }
    },
  };
}

/**
 * Writes each document, and an INDEX.md into its folder unless one is there:
 * a category folder the gate finds a document in must also have its index.
 */
async function writeDocs(docs: string, paths: string[]): Promise<void> {
  for (const path of paths) {
    const full = join(docs, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, `# ${path}\n`, "utf8");
    const index = join(dirname(full), "INDEX.md");
    if (path.includes("/") && !(await stat(index).then(() => true, () => false))) {
      await writeFile(index, "# Index\n", "utf8");
    }
  }
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

## Phase 1

- concepts/alpha.md — Core, 100 lines
- concepts/alpha.md — owns: alpha; references: none
`;

describe("saaga run init", () => {
  test("phase-0-only plan: architecture, plan-init, slice-doc(0), install-rules, baseline", async () => {
    const { app } = await tmpAppEnv("salesforce");
    const planScenario = planInitScenario(SINGLE_PHASE_PLAN);

    const fake = new FakeAgent({
      "Document the Architecture": architectureScenario(),
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planScenario.scenario,
      "Document a Plan Slice": sliceScenario(),
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
      "Document the Architecture": architectureScenario(),
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

## Phase 1

- concepts/alpha.md — Core, 100 lines
- concepts/alpha.md — owns: alpha; references: none

## Phase 2

- features/login.md — Supporting, 60 lines
- features/login.md — owns: login; references: none
`;

    const fake = new FakeAgent({
      "Document the Architecture": architectureScenario(),
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planInitScenario(planContent).scenario,
      "Document a Plan Slice": sliceScenario(),
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
      "Document the Architecture": architectureScenario(),
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation":
        planInitScenario(ONE_NONZERO_PHASE_PLAN).scenario,
      "Document a Plan Slice": sliceScenario(),
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
      "Document the Architecture": architectureScenario(),
      "Plan Domain Documentation": planInitScenario(SINGLE_PHASE_PLAN).scenario,
      "Verify the Architecture Document": verifyScenario((i) =>
        i >= 2 ? "PASS" : "FAIL",
      ),
      "Fix Documentation Errors": { exitCode: 0 },
      "Document a Plan Slice": sliceScenario(),
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
      "Document the Architecture": architectureScenario(),
      "Plan Domain Documentation": planInitScenario(SINGLE_PHASE_PLAN).scenario,
      "Verify the Architecture Document": verifyScenario((i) =>
        i >= 2 ? "PASS" : "FAIL",
      ),
      "Fix Documentation Errors": { exitCode: 0 },
      "Document a Plan Slice": sliceScenario(),
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
      "Document the Architecture": architectureScenario(),
      "Plan Domain Documentation": planInitScenario(SINGLE_PHASE_PLAN).scenario,
      "Verify the Architecture Document": verifyScenario(() => "FAIL"),
      "Fix Documentation Errors": { exitCode: 0 },
      "Document a Plan Slice": sliceScenario(),
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

## Phase 1

- concepts/alpha.md — Core, 100 lines
- concepts/alpha.md — owns: alpha; references: none
`;

    const fake = new FakeAgent({
      "Document the Architecture": architectureScenario(),
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planInitScenario(planContent).scenario,
      "Document a Plan Slice": sliceScenario(),
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
      "Document the Architecture": architectureScenario(),
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planInitScenario(SINGLE_PHASE_PLAN).scenario,
      "Document a Plan Slice": sliceScenario(),
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
      "Document the Architecture": architectureScenario(),
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planInitScenario(SINGLE_PHASE_PLAN).scenario,
      "Document a Plan Slice": sliceScenario(),
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
      "Document the Architecture": architectureScenario(),
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planScenario.scenario,
      "Document a Plan Slice": sliceScenario(),
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
      // plan-init runs inside the corpus-budget loop, so it is archived with
      // the iteration that produced it.
      "02-plan-init-iter1.md",
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
      "Document the Architecture": architectureScenario(),
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planScenario.scenario,
      "Document a Plan Slice": sliceScenario(),
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

  test("a run that failed before writing anything does not block a fresh init", async () => {
    const { app } = await tmpAppEnv("retry");
    const broken = new FakeAgent({ "Document the Architecture": { exitCode: 1 } });

    expect(
      await runCli(["run", "init", app], { agent: broken, stderr: new StringWritable() }),
    ).toBe(1);
    // The create step ran, so the empty category folders are still there.
    expect((await readdir(join(app, DEFAULT_DOCS_DIR))).sort()).toEqual([
      "concepts",
      "conventions",
      "features",
      "patterns",
    ]);

    const fake = new FakeAgent({
      "Document the Architecture": {
        exitCode: 0,
        effect: async () => {
          const architecture = join(app, DEFAULT_DOCS_DIR, "ARCHITECTURE.md");
          await writeFile(architecture, "# Architecture\n", "utf8");
        },
      },
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planInitScenario(SINGLE_PHASE_PLAN).scenario,
      "Document a Plan Slice": { exitCode: 0 },
    });

    expect(await runCli(["run", "init", app], { agent: fake })).toBe(0);
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
      "Document the Architecture": architectureScenario(),
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planScenario.scenario,
      "Document a Plan Slice": sliceScenario(),
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

  test("an agent that cannot create folders still writes into the corpus", async () => {
    const { app } = await tmpAppEnv("nomkdir");
    const docs = join(app, DEFAULT_DOCS_DIR);

    // Like Copilot's file tool: writeFile without mkdir fails on a missing parent.
    const writeArchitecture: FakeScenarioValue = {
      exitCode: 0,
      effect: async () => {
        await writeFile(join(docs, "ARCHITECTURE.md"), "# Architecture — nomkdir\n", "utf8");
      },
    };
    const writeIndexes: FakeScenarioValue = {
      exitCode: 0,
      effect: async () => {
        for (const category of ["concepts", "patterns", "features"]) {
          await writeFile(join(docs, category, "INDEX.md"), "# Index\n", "utf8");
        }
      },
    };

    const fake = new FakeAgent({
      "Document the Architecture": writeArchitecture,
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planInitScenario(SINGLE_PHASE_PLAN).scenario,
      "Document a Plan Slice": writeIndexes,
    });

    expect(await runCli(["run", "init", app], { agent: fake })).toBe(0);

    expect((await stat(join(docs, "ARCHITECTURE.md"))).isFile()).toBe(true);
    for (const category of ["concepts", "patterns", "features"]) {
      expect((await stat(join(docs, category, "INDEX.md"))).isFile()).toBe(true);
    }
    // Nothing was written into conventions/, so the prune step removed it.
    expect(await readdir(docs)).not.toContain("conventions");
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
      "Document the Architecture": architectureScenario(),
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

/**
 * What these prove is the *wiring*: that the loop binds real numbers into the
 * verify prompt, that `deferred_minors_path` renders to a writable path under
 * the run directory, that a `PASS` written with findings outstanding ends the
 * loop without a fix session, and that a corpus with deleted stamps still
 * survives generate-baseline, generate-navigation and validate-docs.
 *
 * They do not prove the model obeys the prompt — the fake agent here does what
 * a compliant verifier would do. tests/prompts.test.ts pins the instructions.
 */
describe("the verification threshold and the per-document stamp", () => {
  const ALPHA = ["concepts", "alpha.md"];
  const BETA = ["concepts", "beta.md"];

  function doc(title: string, stamp: string | null): string {
    return [
      "---",
      `title: ${title}`,
      "type: concept",
      ...(stamp ? [`last_verified: ${stamp}`] : []),
      "sources:",
      "  - src/x.ts",
      "---",
      "",
      `# ${title}`,
      "",
    ].join("\n");
  }

  /** Writes a two-document slice; alpha carries a stale stamp so its deletion is observable. */
  function writeCorpus(docs: string): FakeScenarioValue {
    return {
      exitCode: 0,
      effect: async () => {
        await mkdir(join(docs, "concepts"), { recursive: true });
        await writeFile(
          join(docs, "ARCHITECTURE.md"),
          "# Architecture — stampdemo\n",
          "utf8",
        );
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
        await writeFile(join(docs, ...ALPHA), doc("Alpha", "2020-01-01"), "utf8");
        await writeFile(join(docs, ...BETA), doc("Beta", null), "utf8");
      },
    };
  }

  function scrape(prompt: string) {
    const status = prompt.match(/Write the verification status to `([^`]+)`/);
    const date = prompt.match(/Today's date: `([^`]+)`/);
    const deferred = prompt.match(/Deferred-findings report to write: `([^`]+)`/);
    const round = prompt.match(/This verification round: `(\d+)` of `(\d+)`/);
    if (!status || !date || !deferred || !round) {
      throw new Error("verify prompt did not carry the lines the test scrapes");
    }
    return {
      statusPath: status[1],
      date: date[1],
      deferredPath: deferred[1],
      round: Number(round[1]),
      cap: Number(round[2]),
    };
  }

  /** Updates the field if present, adds it if not — the prompt's own wording. */
  async function stamp(path: string, date: string): Promise<void> {
    const content = await readFile(path, "utf8");
    await writeFile(
      path,
      content
        .replace(/^last_verified: .*\n/m, "")
        .replace(/^type: concept$/m, `type: concept\nlast_verified: ${date}`),
      "utf8",
    );
  }

  async function unstamp(path: string): Promise<void> {
    const content = await readFile(path, "utf8");
    await writeFile(path, content.replace(/^last_verified: .*\n/m, ""), "utf8");
  }

  async function stampOf(path: string): Promise<string | undefined> {
    return parseDoc(await readFile(path, "utf8")).frontmatter?.last_verified;
  }

  test("a minor-only slice passes on the first round: the flagged doc loses its stamp, its clean sibling keeps one", async () => {
    const { app } = await tmpAppEnv("stampdemo");
    const docs = join(app, DEFAULT_DOCS_DIR);

    const verifySlice: FakeScenarioValue = {
      exitCode: 0,
      effect: async (_opts, prompt) => {
        const { statusPath, date, deferredPath } = scrape(prompt);
        // One Minor against alpha: under the new threshold that is a PASS.
        await mkdir(dirname(statusPath), { recursive: true });
        await writeFile(statusPath, "PASS", "utf8");
        await unstamp(join(docs, ...ALPHA));
        await stamp(join(docs, ...BETA), date);
        await mkdir(dirname(deferredPath), { recursive: true });
        await writeFile(
          deferredPath,
          [
            "# Deferred Findings",
            "",
            "| Document | Section | Claim | Severity | Evidence | Verdict | Review |",
            "|---|---|---|---|---|---|---|",
            `| ${join(DEFAULT_DOCS_DIR, ...ALPHA)} | # Alpha | Budget Overrun | Minor | 1.3x | PASS (minor deferred) | r |`,
            "",
          ].join("\n"),
          "utf8",
        );
      },
    };

    const fake = new FakeAgent({
      "Document the Architecture": architectureScenario(),
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planInitScenario(ONE_NONZERO_PHASE_PLAN).scenario,
      "Document a Plan Slice": writeCorpus(docs),
      "Verify Domain Documentation Slice": verifySlice,
      "Fix Documentation Errors": { exitCode: 0 },
    });

    expect(await runCli(["run", "init", app], { agent: fake })).toBe(0);

    // The point of the task: one verify session, and no fix session at all,
    // where the old threshold would have spent three of each.
    const verifies = fake.calls.filter((c) =>
      c.prompt.includes("Verify Domain Documentation Slice"),
    );
    const fixes = fake.calls.filter((c) =>
      c.prompt.includes("Fix Documentation Errors"),
    );
    expect(verifies).toHaveLength(1);
    expect(fixes).toHaveLength(0);
    expect(verifies[0].prompt).toContain("`1` of `3`");

    expect(await stampOf(join(docs, ...ALPHA))).toBeUndefined();
    expect(await stampOf(join(docs, ...BETA))).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const runs = await readdir(join(app, ".saaga-runs"));
    const deferred = await readFile(
      join(app, ".saaga-runs", runs[0], "slice-1", "deferred-minors.md"),
      "utf8",
    );
    expect(deferred).toContain("# Deferred Findings");
    expect(deferred).toContain(join(DEFAULT_DOCS_DIR, ...ALPHA));
    expect(deferred).toContain("PASS (minor deferred)");
  });

  test("a final-round FAIL unstamps the documents it implicates", async () => {
    const { app } = await tmpAppEnv("exhausted");
    const docs = join(app, DEFAULT_DOCS_DIR);

    const verifySlice: FakeScenarioValue = {
      exitCode: 0,
      effect: async (_opts, prompt) => {
        const { statusPath, date, deferredPath, round, cap } = scrape(prompt);
        await mkdir(dirname(statusPath), { recursive: true });
        await writeFile(statusPath, "FAIL", "utf8");
        // The stamp rule runs every round, so beta is stamped each time and
        // alpha — named by a finding — never is.
        await unstamp(join(docs, ...ALPHA));
        await stamp(join(docs, ...BETA), date);
        if (round === cap) {
          await mkdir(dirname(deferredPath), { recursive: true });
          await writeFile(
            deferredPath,
            [
              "# Deferred Findings",
              "",
              "| Document | Section | Claim | Severity | Evidence | Verdict | Review |",
              "|---|---|---|---|---|---|---|",
              `| ${join(DEFAULT_DOCS_DIR, ...ALPHA)} | # Alpha | wrong API | Major | src/x.ts | FAIL (round ${round} of ${cap}) | r |`,
              "",
            ].join("\n"),
            "utf8",
          );
        }
      },
    };

    const fake = new FakeAgent({
      "Document the Architecture": architectureScenario(),
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planInitScenario(ONE_NONZERO_PHASE_PLAN).scenario,
      "Document a Plan Slice": writeCorpus(docs),
      "Verify Domain Documentation Slice": verifySlice,
      "Fix Documentation Errors": { exitCode: 0 },
    });

    expect(await runCli(["run", "init", app], { agent: fake })).toBe(0);

    const verifies = fake.calls.filter((c) =>
      c.prompt.includes("Verify Domain Documentation Slice"),
    );
    // Three verifies and three fixes: the fix after the final FAIL is the
    // unverified session the motivation counts.
    expect(verifies).toHaveLength(3);
    expect(
      fake.calls.filter((c) => c.prompt.includes("Fix Documentation Errors")),
    ).toHaveLength(3);

    // The end-to-end proof of ${loop_max}: the cap reaches the prompt and the
    // round counts up to it.
    expect(verifies.map((c) => c.prompt.match(/`(\d)` of `(\d)`/)![0])).toEqual([
      "`1` of `3`",
      "`2` of `3`",
      "`3` of `3`",
    ]);

    expect(await stampOf(join(docs, ...ALPHA))).toBeUndefined();
    expect(await stampOf(join(docs, ...BETA))).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const runs = await readdir(join(app, ".saaga-runs"));
    const deferred = await readFile(
      join(app, ".saaga-runs", runs[0], "slice-1", "deferred-minors.md"),
      "utf8",
    );
    expect(deferred).toContain("FAIL (round 3 of 3)");
  });

  test("the architecture verifier gets the round and its own report path", async () => {
    const { app } = await tmpAppEnv("archdeferred");

    const fake = new FakeAgent({
      "Document the Architecture": architectureScenario(),
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planInitScenario(SINGLE_PHASE_PLAN).scenario,
      "Document a Plan Slice": sliceScenario(),
    });

    expect(await runCli(["run", "init", app], { agent: fake })).toBe(0);

    const prompt = fake.calls.find((c) =>
      c.prompt.includes("Verify the Architecture Document"),
    )!.prompt;
    expect(prompt).toContain("`1` of `3`");
    // Its own file, not the slices': one writer per report.
    const line = prompt
      .split("\n")
      .find((l) => l.includes("Deferred-findings report to write"))!;
    expect(line).toContain(join(app, ".saaga-runs"));
    expect(line).toContain(join("architecture", "deferred-minors.md"));
  });
});

/**
 * Task 10: an over-budget plan is retried, not edited and not accepted. The
 * loop primitive exits silently at its cap, so the enforce step after it is
 * what actually stops the run before a slice writer spends anything.
 */
describe("saaga run init: the corpus budget", () => {
  /** An app with enough source that the derived ceilings are nonzero. */
  async function tmpSourceApp(name: string) {
    const root = await mkdtemp(join(tmpdir(), "saaga-test-"));
    const app = join(root, name);
    await mkdir(join(app, "src"), { recursive: true });
    await writeFile(join(app, "src", "a.ts"), "x\n".repeat(4200), "utf8");
    return { root, app };
  }

  const HEADER = `---\nphases:\n  - number: 0\n    title: "Setup Structure"\n  - number: 1\n    title: "Core"\n---\n\n## Phase 1\n\n`;

  function plan(docCount: number): string {
    const body = Array.from(
      { length: docCount },
      (_, i) =>
        `- concepts/d${i}.md — Core, 100 lines\n` +
        `- concepts/d${i}.md — owns: thing ${i}; references: none\n`,
    ).join("");
    return HEADER + body;
  }

  /** Serves a different plan per plan-init call. */
  function planSequence(plans: string[]): FakeScenarioValue {
    let call = 0;
    return {
      exitCode: 0,
      effect: async (_opts, prompt) => {
        const m = prompt.match(/Write the plan to `([^`]+)`/);
        if (!m) throw new Error("plan path not found in plan-init prompt");
        await mkdir(dirname(m[1]), { recursive: true });
        await writeFile(m[1], plans[Math.min(call, plans.length - 1)], "utf8");
        call++;
      },
    };
  }

  test("an in-budget plan is planned once and proceeds", async () => {
    const { app } = await tmpSourceApp("budgeted");
    const fake = new FakeAgent({
      "Document the Architecture": architectureScenario(),
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planSequence([plan(5)]),
      "Document a Plan Slice": sliceScenario(),
      "Verify Domain Documentation": verifyScenario(() => "PASS"),
    });

    expect(await runCli(["run", "init", app], { agent: fake })).toBe(0);

    const planCalls = fake.calls.filter((c) =>
      c.prompt.includes("Plan Domain Documentation"),
    );
    expect(planCalls).toHaveLength(1);
  });

  test("an over-budget plan is re-planned, and the retry sees the report", async () => {
    const { app } = await tmpSourceApp("retried");
    const fake = new FakeAgent({
      "Document the Architecture": architectureScenario(),
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planSequence([plan(40), plan(4)]),
      "Document a Plan Slice": sliceScenario(),
      "Verify Domain Documentation": verifyScenario(() => "PASS"),
    });

    expect(await runCli(["run", "init", app], { agent: fake })).toBe(0);

    const planCalls = fake.calls.filter((c) =>
      c.prompt.includes("Plan Domain Documentation"),
    );
    expect(planCalls).toHaveLength(2);

    // The retry is handed the path the gate writes its verdict to.
    expect(planCalls[1].prompt).toContain("plan-budget-report.md");

    // One fixed path, overwritten per attempt, so it ends holding the verdict
    // that let the run continue.
    const [runDir] = await readdir(join(app, ".saaga-runs"));
    const report = await readFile(
      join(app, ".saaga-runs", runDir, "plan-budget-report.md"),
      "utf8",
    );
    expect(report).toContain("Status: **PASS**");
    // 4 planned documents, plus the ARCHITECTURE.md the flow always writes.
    expect(report).toContain("| Documents | 5 |");
  });

  test("a persistently over-budget plan fails at the enforce step", async () => {
    const { app } = await tmpSourceApp("overbudget");
    const fake = new FakeAgent({
      "Document the Architecture": architectureScenario(),
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Plan Domain Documentation": planSequence([plan(40)]),
      "Document a Plan Slice": sliceScenario(),
    });

    await expect(runCli(["run", "init", app], { agent: fake })).rejects.toThrow(
      /delete saaga-docs\/ and run .saaga run init. again/,
    );

    // Three attempts, then the enforce step — and no slice writer ran.
    expect(
      fake.calls.filter((c) => c.prompt.includes("Plan Domain Documentation")),
    ).toHaveLength(3);
    expect(fake.calls.some((c) => c.prompt.includes("Document a Plan Slice"))).toBe(false);
  });
});

/**
 * Issue #73. Under the Copilot backend the writers could not create the docs
 * directory, so every document the plan named went unwritten — and the run
 * still reported success, baselined the empty corpus, and left `update` with
 * nothing to detect. Each writer is an agent step that exits 0 whatever it
 * wrote, the verify loops end silently at their cap, and `validate-docs`
 * passes over an empty corpus, so the check has to be its own step and it has
 * to sit before the baseline.
 */
describe("saaga run init: the planned documents must exist", () => {
  const PLAN = `---
phases:
  - number: 0
    title: "Setup Structure"
  - number: 1
    title: "Core"
---

## Phase 1

- concepts/alpha.md — Core, 100 lines
- concepts/alpha.md — owns: alpha; references: none
- features/login.md — Supporting, 60 lines
- features/login.md — owns: login; references: none
`;

  /** The error the run fails with; a run that succeeds fails the test. */
  async function failureOf(run: Promise<number>): Promise<Error> {
    return run.then(
      (code) => {
        throw new Error(`expected the run to fail, but it exited ${code}`);
      },
      (e: unknown) => e as Error,
    );
  }

  /** The run directory of the one run this app has had. */
  async function manifestOf(app: string): Promise<{ status: string }> {
    const [runDir] = await readdir(join(app, ".saaga-runs"));
    const raw = await readFile(join(app, ".saaga-runs", runDir, "run.json"), "utf8");
    return JSON.parse(raw) as { status: string };
  }

  test("a run whose writers wrote nothing fails instead of baselining", async () => {
    const { app } = await tmpAppEnv("silentwriters");

    // Every agent reports success and writes nothing: the #73 run exactly.
    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Plan Domain Documentation": planInitScenario(PLAN).scenario,
      "Verify the Architecture Document": verifyScenario(() => "FAIL"),
      "Verify Domain Documentation Slice": verifyScenario(() => "FAIL"),
      "Fix Documentation Errors": { exitCode: 0 },
      "Document a Plan Slice": { exitCode: 0 },
    });

    const err = new StringWritable();
    const thrown = await failureOf(runCli(["run", "init", app], { agent: fake, stderr: err }));

    expect(thrown.message).toContain("were never written");
    // All three: the architecture document the plan never names, and both
    // documents phase 1 promised.
    expect(thrown.message).toContain("saaga-docs/ARCHITECTURE.md");
    expect(thrown.message).toContain("saaga-docs/concepts/alpha.md");
    expect(thrown.message).toContain("saaga-docs/features/login.md");
    expect(thrown.message).toContain("delete saaga-docs/");

    // The point of the issue: no BASELINE, so the next `update` still sees
    // the whole repository as undocumented.
    await expect(stat(join(app, DEFAULT_DOCS_DIR, "BASELINE"))).rejects.toThrow();
    expect((await manifestOf(app)).status).toBe("failed");

    // Resuming skips the agent steps but runs this check again, so once the
    // documents are written the run can still finish: the hint stays.
    expect(err.text).toContain("failed. To resume: saaga run --resume");
  });

  test("a partly written corpus names only what is missing", async () => {
    const { app } = await tmpAppEnv("partial");

    // Architecture lands and so does one of the two planned documents, with
    // its index; the other category gets neither.
    const halfSlice: FakeScenarioValue = {
      exitCode: 0,
      effect: async (opts) => {
        await writeDocs(join(opts.cwd, DEFAULT_DOCS_DIR), ["concepts/alpha.md"]);
      },
    };

    const fake = new FakeAgent({
      "Document the Architecture": architectureScenario(),
      "Plan Domain Documentation": planInitScenario(PLAN).scenario,
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Verify Domain Documentation Slice": verifyScenario(() => "PASS"),
      "Document a Plan Slice": halfSlice,
    });

    const thrown = await failureOf(runCli(["run", "init", app], { agent: fake }));

    expect(thrown.message).toContain("2 of 5 documents");
    expect(thrown.message).toContain("saaga-docs/features/INDEX.md");
    expect(thrown.message).toContain("saaga-docs/features/login.md");
    expect(thrown.message).not.toContain("alpha.md");
    expect(thrown.message).not.toContain("concepts/INDEX.md");
    await expect(stat(join(app, DEFAULT_DOCS_DIR, "BASELINE"))).rejects.toThrow();
  });

  test("writing the missing document by hand and resuming finishes the run", async () => {
    const { app } = await tmpAppEnv("byhand");
    const docs = join(app, DEFAULT_DOCS_DIR);
    const alphaOnly: FakeScenarioValue = {
      exitCode: 0,
      effect: async () => {
        await writeDocs(docs, ["concepts/alpha.md"]);
      },
    };
    const fake = new FakeAgent({
      "Document the Architecture": architectureScenario(),
      "Plan Domain Documentation": planInitScenario(PLAN).scenario,
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Verify Domain Documentation Slice": verifyScenario(() => "PASS"),
      "Document a Plan Slice": alphaOnly,
    });

    const stderr = new StringWritable();
    const thrown = await failureOf(runCli(["run", "init", app], { agent: fake, stderr }));
    expect(thrown.message).toContain("saaga-docs/features/login.md");

    await writeDocs(docs, ["features/login.md"]);

    // Every agent step already ran, so an agent call on resume would throw.
    const [id] = await readdir(join(app, ".saaga-runs"));
    const none = new FakeAgent({});
    expect(
      await runCli(["run", "--resume", id, app], { agent: none, stderr: new StringWritable() }),
    ).toBe(0);
    expect(none.calls).toHaveLength(0);
    expect((await stat(join(docs, "BASELINE"))).isFile()).toBe(true);
    expect((await manifestOf(app)).status).toBe("completed");
  });

  test("markdown source files a slice names do not fail a complete corpus", async () => {
    const { app } = await tmpAppEnv("keyfiles");
    const plan =
      PLAN +
      "- **Key files to analyze**:\n" +
      "  - `CONTRIBUTING.md` — the release checklist login follows\n" +
      "  - docs/decisions.md — why login works this way\n";

    // Writes the two planned documents and their indexes and nothing else,
    // independent of the roster parser the check uses.
    const writer: FakeScenarioValue = {
      exitCode: 0,
      effect: async (opts) => {
        await writeDocs(join(opts.cwd, DEFAULT_DOCS_DIR), [
          "concepts/alpha.md",
          "features/login.md",
        ]);
      },
    };
    const fake = new FakeAgent({
      "Document the Architecture": architectureScenario(),
      "Plan Domain Documentation": planInitScenario(plan).scenario,
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Verify Domain Documentation Slice": verifyScenario(() => "PASS"),
      "Document a Plan Slice": writer,
    });

    expect(await runCli(["run", "init", app], { agent: fake })).toBe(0);
    expect((await stat(join(app, DEFAULT_DOCS_DIR, "BASELINE"))).isFile()).toBe(true);
  });

  test("a complete corpus baselines and stamps as before", async () => {
    const { app } = await tmpAppEnv("complete");

    const fake = new FakeAgent({
      "Document the Architecture": architectureScenario(),
      "Plan Domain Documentation": planInitScenario(PLAN).scenario,
      "Verify the Architecture Document": verifyScenario(() => "PASS"),
      "Verify Domain Documentation Slice": verifyScenario(() => "PASS"),
      "Document a Plan Slice": sliceScenario(),
    });

    expect(await runCli(["run", "init", app], { agent: fake })).toBe(0);

    expect((await stat(join(app, DEFAULT_DOCS_DIR, "BASELINE"))).isFile()).toBe(true);
    expect((await manifestOf(app)).status).toBe("completed");
  });
});
