import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Writable } from "node:stream";
import { describe, expect, test, vi } from "vitest";
import { FakeAgent, type FakeScenarioValue } from "../../src/agent/fake-agent.js";
import { createJournal, openJournal, type StepRecord } from "../../src/engine/journal.js";
import { parseFlowDefinition } from "../../src/engine/loader.js";
import {
  AgentStepFailedError,
  RunAbortedError,
  runFlow,
  type RunFlowDeps,
} from "../../src/engine/runner.js";
import type { Scope } from "../../src/engine/types.js";
import { Logger } from "../../src/logger.js";
import type { ScriptHandler } from "../../src/scripts/registry.js";

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

const PHASES = [
  { number: 0, title: "overview" },
  { number: 1, title: "one" },
  { number: 2, title: "two" },
];

/**
 * An init-shaped flow using all six primitives: a script that sets the
 * phases, an agent, a filtered foreach whose body is an agent plus a
 * verify/read-file/if-fix loop, and a closing script.
 */
const FLOW = parseFlowDefinition({
  name: "fixture",
  steps: [
    { script: { name: "plan", label: "planning", set: "phases" } },
    { agent: { prompt: "document-architecture", label: "architecture", vars: { app: "${app}" } } },
    {
      foreach: {
        var: "phase",
        in: "${phases}",
        when: "${phase.number} != 0",
        do: [
          {
            agent: {
              prompt: "slice-doc",
              label: 'documenting "${phase.title}"',
              vars: { phase_number: "${phase.number}" },
            },
          },
          {
            loop: {
              max: 3,
              until: '${status} == "PASS"',
              do: [
                {
                  agent: {
                    prompt: "verify-domain-documentation",
                    label: 'verifying "${phase.title}"',
                    vars: {
                      phase_number: "${phase.number}",
                      status_path: "${run_dir}/status-${phase.number}-${iteration}.txt",
                    },
                  },
                },
                {
                  "read-file": {
                    path: "${run_dir}/status-${phase.number}-${iteration}.txt",
                    set: "status",
                    trim: true,
                  },
                },
                {
                  if: '${status} != "PASS"',
                  then: [
                    {
                      agent: {
                        prompt: "fix-documentation",
                        label: 'fixing "${phase.title}"',
                        vars: { phase_number: "${phase.number}" },
                      },
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    },
    { script: { name: "finish", label: "finishing", set: "done" } },
  ],
});

async function tmpRunDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "saaga-resume-"));
}

/** Writes the status file the verify prompt names, choosing PASS/FAIL per call. */
function verifyScenario(
  statusFor: (phase: string, iteration: number) => "PASS" | "FAIL",
): FakeScenarioValue {
  const seen = new Map<string, number>();
  return {
    exitCode: 0,
    effect: async (_opts, prompt) => {
      const m = prompt.match(/Write the verification status to `([^`]+)`/);
      if (!m) throw new Error("status path not found in verify prompt");
      const phase = prompt.match(/status-(\d+)-/)?.[1] ?? "?";
      const n = (seen.get(phase) ?? 0) + 1;
      seen.set(phase, n);
      await mkdir(dirname(m[1]), { recursive: true });
      await writeFile(m[1], statusFor(phase, n), "utf8");
    },
  };
}

async function journalLines(runDir: string): Promise<StepRecord[]> {
  const text = await readFile(join(runDir, "steps.jsonl"), "utf8");
  return text.trim().split("\n").map((l) => JSON.parse(l) as StepRecord);
}

function baseDeps(agent: FakeAgent, extra: Partial<RunFlowDeps>): RunFlowDeps {
  return { agent, cwd: "/x", ...extra };
}

describe("journal + replay", () => {
  test("an interrupted nested run resumes at the interrupted step with scope restored", async () => {
    const runDir = await tmpRunDir();
    const scope: Scope = { app: "myapp", run_dir: runDir };
    const controller = new AbortController();

    // First attempt: phase 1 fails verification once, then passes; the
    // slice-doc step of phase 2 is interrupted.
    const plan = vi.fn<ScriptHandler>(async () => PHASES);
    const finish = vi.fn<ScriptHandler>(async () => "yes");
    const first = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Document a Plan Slice": {
        exitCode: 0,
        effect: () => {
          // Interrupt the second slice-doc call, i.e. phase 2.
          const slices = first.calls.filter((c) =>
            c.prompt.includes("Document a Plan Slice"),
          ).length;
          if (slices === 2) controller.abort();
        },
      },
      "Verify Domain Documentation Slice": verifyScenario((phase, n) =>
        phase === "1" && n === 1 ? "FAIL" : "PASS",
      ),
      "Fix Documentation Errors": { exitCode: 0 },
    });

    await expect(
      runFlow(FLOW, scope, baseDeps(first, {
        scripts: { plan, finish },
        journal: createJournal(runDir),
        signal: controller.signal,
      })),
    ).rejects.toBeInstanceOf(RunAbortedError);

    const before = await journalLines(runDir);
    expect(before.map((r) => r.addr)).toEqual([
      "steps[0]",
      "steps[1]",
      "steps[2]@1/do[0]",
      "steps[2]@1/do[1]#1/do[0]",
      "steps[2]@1/do[1]#1/do[1]",
      "steps[2]@1/do[1]#1/do[2]/then[0]",
      "steps[2]@1/do[1]#2/do[0]",
      "steps[2]@1/do[1]#2/do[1]",
    ]);
    expect(before[0]).toMatchObject({ type: "script", set: "phases", value: PHASES });
    expect(before[4]).toMatchObject({ type: "read-file", set: "status", value: "FAIL" });
    expect(before[7]).toMatchObject({ type: "read-file", set: "status", value: "PASS" });
    expect(finish).not.toHaveBeenCalled();

    // Remove the status files: the resumed run must replay their values
    // from the journal, not re-read them.
    for (const f of await readdir(runDir)) {
      if (f.startsWith("status-")) await rm(join(runDir, f));
    }

    // Second attempt.
    const plan2 = vi.fn<ScriptHandler>(async () => {
      throw new Error("plan must not run again");
    });
    const finish2 = vi.fn<ScriptHandler>(async () => "yes");
    const second = new FakeAgent({
      "Document a Plan Slice": { exitCode: 0 },
      "Verify Domain Documentation Slice": verifyScenario(() => "PASS"),
    });
    const stream = new StringWritable();
    const resumedScope: Scope = { ...scope };
    await runFlow(FLOW, resumedScope, baseDeps(second, {
      scripts: { plan: plan2, finish: finish2 },
      journal: await openJournal(runDir),
      logger: new Logger({ ci: true, stream }),
      resumeNote: "RESUME-NOTE",
    }));

    expect(plan2).not.toHaveBeenCalled();
    expect(finish2).toHaveBeenCalledTimes(1);
    expect(second.calls.map((c) => c.prompt.split("\n")[0])).toEqual([
      "# Document a Plan Slice",
      "# Verify Domain Documentation Slice",
    ]);
    // Only the step the earlier attempt was interrupted in gets the note.
    expect(second.calls[0].prompt).toContain("RESUME-NOTE");
    expect(second.calls[1].prompt).not.toContain("RESUME-NOTE");

    const after = await journalLines(runDir);
    expect(after.map((r) => r.addr).slice(8)).toEqual([
      "steps[2]@2/do[0]",
      "steps[2]@2/do[1]#1/do[0]",
      "steps[2]@2/do[1]#1/do[1]",
      "steps[3]",
    ]);
    expect(after[after.length - 1]).toMatchObject({ set: "done", value: "yes" });

    // Phase numbering continues as if nothing had happened.
    const out = stream.text;
    expect(out).toContain("Phase 1/5: planning (done in earlier run)");
    expect(out).toContain("[SKIP]");
    expect(out).toContain('Phase 4/5: documenting "two"');
    expect(out).toContain("Phase 5/5: finishing");
    expect(out).toContain("saaga fixture: 5 phases");
  });

  test("an abort signalled while the agent exits cleanly is still an interruption", async () => {
    const runDir = await tmpRunDir();
    const controller = new AbortController();
    const agent = new FakeAgent({
      "Document the Architecture": {
        exitCode: 0,
        effect: () => controller.abort(),
      },
      "Document a Plan Slice": { exitCode: 0 },
    });
    const flow = parseFlowDefinition({
      name: "two",
      steps: [
        { agent: { prompt: "document-architecture" } },
        { agent: { prompt: "slice-doc" } },
      ],
    });
    await expect(
      runFlow(flow, { run_dir: runDir }, baseDeps(agent, {
        journal: createJournal(runDir),
        signal: controller.signal,
      })),
    ).rejects.toBeInstanceOf(RunAbortedError);
    expect(agent.calls).toHaveLength(1);
    await expect(readFile(join(runDir, "steps.jsonl"), "utf8")).rejects.toThrow();
  });

  test("an abort during a script stops before the next step and keeps the script's record", async () => {
    const runDir = await tmpRunDir();
    const controller = new AbortController();
    const agent = new FakeAgent({ "Document the Architecture": { exitCode: 0 } });
    const tick = vi.fn<ScriptHandler>(async () => {
      controller.abort();
      return 1;
    });
    const flow = parseFlowDefinition({
      name: "s",
      steps: [
        { script: { name: "tick", set: "n" } },
        { agent: { prompt: "document-architecture" } },
      ],
    });
    await expect(
      runFlow(flow, { run_dir: runDir }, baseDeps(agent, {
        scripts: { tick },
        journal: createJournal(runDir),
        signal: controller.signal,
      })),
    ).rejects.toBeInstanceOf(RunAbortedError);
    expect(agent.calls).toHaveLength(0);
    expect((await journalLines(runDir)).map((r) => r.addr)).toEqual(["steps[0]"]);
  });

  test("a plain failure is not journaled and is not an interruption", async () => {
    const runDir = await tmpRunDir();
    const agent = new FakeAgent({ "Document the Architecture": { exitCode: 3 } });
    const flow = parseFlowDefinition({
      name: "f",
      steps: [{ agent: { prompt: "document-architecture" } }],
    });
    await expect(
      runFlow(flow, { run_dir: runDir }, baseDeps(agent, { journal: createJournal(runDir) })),
    ).rejects.toBeInstanceOf(AgentStepFailedError);
    await expect(readFile(join(runDir, "steps.jsonl"), "utf8")).rejects.toThrow();
  });

  test("without a journal the runner behaves as before", async () => {
    const agent = new FakeAgent({ "Document the Architecture": { exitCode: 0 } });
    const flow = parseFlowDefinition({
      name: "f",
      steps: [{ agent: { prompt: "document-architecture" } }],
    });
    await runFlow(flow, {}, baseDeps(agent, {}));
    expect(agent.calls).toHaveLength(1);
  });
});

describe("prompt archive on resume", () => {
  test("numbering continues after the prompts of an earlier attempt", async () => {
    const runDir = await tmpRunDir();
    await mkdir(join(runDir, "prompts"));
    await writeFile(join(runDir, "prompts", "01-plan-init.md"), "a", "utf8");
    await writeFile(join(runDir, "prompts", "02-slice-doc-phase0.md"), "b", "utf8");

    const agent = new FakeAgent({ "Document the Architecture": { exitCode: 0 } });
    const flow = parseFlowDefinition({
      name: "f",
      steps: [{ agent: { prompt: "document-architecture" } }],
    });
    await runFlow(flow, { run_dir: runDir }, baseDeps(agent, {}));

    expect((await readdir(join(runDir, "prompts"))).sort()).toEqual([
      "01-plan-init.md",
      "02-slice-doc-phase0.md",
      "03-document-architecture.md",
    ]);
  });
});
