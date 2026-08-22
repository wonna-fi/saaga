import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { PermissionAuditor } from "../../src/agent/audit.js";
import { FakeAgent } from "../../src/agent/fake-agent.js";
import type { AgentPermissions } from "../../src/agent/permissions.js";
import { parseFlowDefinition } from "../../src/engine/loader.js";
import { runFlow } from "../../src/engine/runner.js";

describe("agent step invocation", () => {
  test("forwards ${run_dir} from flow scope as additionalDirs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-agent-step-"));
    const runDir = join(dir, "run-abc123");
    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
    });

    const flow = parseFlowDefinition({
      name: "test",
      steps: [
        {
          agent: {
            prompt: "document-architecture",
            vars: { app: "myapp" },
          },
        },
      ],
    });

    await runFlow(
      flow,
      { app: "myapp", app_path: dir, run_dir: runDir },
      { agent: fake, cwd: dir },
    );

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].additionalDirs).toEqual([runDir]);
  });

  test("omits additionalDirs when run_dir is absent from scope", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-agent-step-"));
    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
    });

    const flow = parseFlowDefinition({
      name: "test",
      steps: [
        {
          agent: {
            prompt: "document-architecture",
            vars: { app: "myapp" },
          },
        },
      ],
    });

    await runFlow(flow, { app: "myapp", app_path: dir }, { agent: fake, cwd: dir });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].additionalDirs).toBeUndefined();
  });

  test("forwards permissions from deps to agent.run()", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-agent-step-"));
    const runDir = join(dir, ".saaga-runs", "run-abc123");
    const permissions: AgentPermissions = {
      readRoots: [dir],
      writeRoots: [resolve(dir, "saaga-docs"), runDir],
      denyPaths: [resolve(dir, "AGENTS.md")],
      shell: "restricted",
    };
    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
    });

    const flow = parseFlowDefinition({
      name: "test",
      steps: [
        {
          agent: {
            prompt: "document-architecture",
            vars: { app: "myapp" },
          },
        },
      ],
    });

    await runFlow(
      flow,
      { app: "myapp", app_path: dir, run_dir: runDir },
      { agent: fake, cwd: dir, permissions },
    );

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].permissions).toEqual(permissions);
  });

  test("routes agent events to the auditor when one is supplied", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-agent-step-"));
    const runDir = join(dir, ".saaga-runs", "run-abc123");
    await mkdir(runDir, { recursive: true });
    const permissions: AgentPermissions = {
      readRoots: [dir],
      writeRoots: [resolve(dir, "saaga-docs"), runDir],
      denyPaths: [],
      shell: "restricted",
    };
    const auditor = new PermissionAuditor(
      permissions,
      dir,
      join(runDir, "permission-audit.log"),
    );

    const fake = new FakeAgent({
      "Document the Architecture": {
        exitCode: 0,
        effect: (opts) =>
          opts.onEvent?.({
            kind: "denial",
            tool: "Write",
            path: "/etc/hostname",
            message: "denied",
          }),
      },
    });

    const flow = parseFlowDefinition({
      name: "test",
      steps: [{ agent: { prompt: "document-architecture", vars: { app: "myapp" } } }],
    });

    await runFlow(
      flow,
      { app: "myapp", app_path: dir, run_dir: runDir },
      { agent: fake, cwd: dir, permissions, auditor },
    );

    expect(fake.calls[0].onEvent).toBeDefined();
    const result = await auditor.flush();
    expect(result.counts["out-of-workspace"]).toBe(1);
  });

  test("leaves onEvent unset when no auditor is supplied", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-agent-step-"));
    const fake = new FakeAgent({ "Document the Architecture": { exitCode: 0 } });
    const flow = parseFlowDefinition({
      name: "test",
      steps: [{ agent: { prompt: "document-architecture", vars: { app: "myapp" } } }],
    });

    await runFlow(
      flow,
      { app: "myapp", app_path: dir, run_dir: join(dir, "run-abc123") },
      { agent: fake, cwd: dir },
    );

    expect(fake.calls[0].onEvent).toBeUndefined();
  });

  test("pre-creates run_dir subdirectories for expect_file before agent.run()", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-agent-step-"));
    const runDir = join(dir, "run-abc123");
    await mkdir(runDir, { recursive: true });

    const planPath = join(runDir, "plans", "myapp-init.plan.md");
    let dirExistedDuringRun = false;

    const fake = new FakeAgent({
      "Document the Architecture": {
        exitCode: 0,
        effect: async () => {
          dirExistedDuringRun = existsSync(dirname(planPath));
          await writeFile(planPath, "plan content\n");
        },
      },
    });

    const flow = parseFlowDefinition({
      name: "test",
      steps: [
        {
          agent: {
            prompt: "document-architecture",
            vars: { app: "myapp", output_path: planPath },
            expect_file: planPath,
          },
        },
      ],
    });

    await runFlow(
      flow,
      { app: "myapp", app_path: dir, run_dir: runDir },
      { agent: fake, cwd: dir },
    );

    expect(dirExistedDuringRun).toBe(true);
  });

  test("pre-creates run_dir subdirectories from vars paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-agent-step-"));
    const runDir = join(dir, "run-abc123");
    await mkdir(runDir, { recursive: true });

    const reviewPath = join(runDir, "slice-1", "review-1.md");
    let dirExistedDuringRun = false;

    const fake = new FakeAgent({
      "Document the Architecture": {
        exitCode: 0,
        effect: async () => {
          dirExistedDuringRun = existsSync(dirname(reviewPath));
        },
      },
    });

    const flow = parseFlowDefinition({
      name: "test",
      steps: [
        {
          agent: {
            prompt: "document-architecture",
            vars: { app: "myapp", review_path: reviewPath },
          },
        },
      ],
    });

    await runFlow(
      flow,
      { app: "myapp", app_path: dir, run_dir: runDir },
      { agent: fake, cwd: dir },
    );

    expect(dirExistedDuringRun).toBe(true);
  });

  test("pre-creates directories from vars paths under writeRoots before agent.run()", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-agent-step-"));
    const runDir = join(dir, ".saaga-runs", "run-abc123");
    await mkdir(runDir, { recursive: true });
    const docsPath = resolve(dir, "saaga-docs");

    const summaryPath = join(
      docsPath,
      "metadata",
      "quick_updates",
      "run-abc123",
      "summary.md",
    );
    let dirExistedDuringRun = false;

    const permissions: AgentPermissions = {
      readRoots: [dir],
      writeRoots: [docsPath, runDir],
      denyPaths: [],
      shell: "restricted",
    };

    const fake = new FakeAgent({
      "Document the Architecture": {
        exitCode: 0,
        effect: async () => {
          dirExistedDuringRun = existsSync(dirname(summaryPath));
        },
      },
    });

    const flow = parseFlowDefinition({
      name: "test",
      steps: [
        {
          agent: {
            prompt: "document-architecture",
            vars: { app: "myapp", summary_path: summaryPath },
          },
        },
      ],
    });

    await runFlow(
      flow,
      { app: "myapp", app_path: dir, run_dir: runDir },
      { agent: fake, cwd: dir, permissions },
    );

    expect(dirExistedDuringRun).toBe(true);
  });

  test("does not pre-create directories for paths outside run_dir and writeRoots", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-agent-step-"));
    const runDir = join(dir, ".saaga-runs", "run-abc123");
    await mkdir(runDir, { recursive: true });
    const docsPath = resolve(dir, "saaga-docs");

    const outsidePath = join(dir, "outside", "nested", "file.txt");
    let dirExistedDuringRun = false;

    const permissions: AgentPermissions = {
      readRoots: [dir],
      writeRoots: [docsPath, runDir],
      denyPaths: [],
      shell: "restricted",
    };

    const fake = new FakeAgent({
      "Document the Architecture": {
        exitCode: 0,
        effect: async () => {
          dirExistedDuringRun = existsSync(dirname(outsidePath));
        },
      },
    });

    const flow = parseFlowDefinition({
      name: "test",
      steps: [
        {
          agent: {
            prompt: "document-architecture",
            vars: { app: "myapp", output_path: outsidePath },
          },
        },
      ],
    });

    await runFlow(
      flow,
      { app: "myapp", app_path: dir, run_dir: runDir },
      { agent: fake, cwd: dir, permissions },
    );

    expect(dirExistedDuringRun).toBe(false);
  });

  test("omits permissions when deps.permissions is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-agent-step-"));
    const runDir = join(dir, "run-abc123");
    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
    });

    const flow = parseFlowDefinition({
      name: "test",
      steps: [
        {
          agent: {
            prompt: "document-architecture",
            vars: { app: "myapp" },
          },
        },
      ],
    });

    await runFlow(
      flow,
      { app: "myapp", app_path: dir, run_dir: runDir },
      { agent: fake, cwd: dir },
    );

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].permissions).toBeUndefined();
  });
});

describe("saagaRules injection", () => {
  test("appends saagaRules to every agent prompt in a multi-step flow", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-agent-step-"));
    const runDir = join(dir, "run-abc123");
    const rules = "Focus on public APIs only.";

    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
      "Plan": { exitCode: 0 },
    });

    const flow = parseFlowDefinition({
      name: "test",
      steps: [
        { agent: { prompt: "document-architecture", vars: { app: "myapp" } } },
        { agent: { prompt: "plan-init", vars: { app: "myapp" } } },
      ],
    });

    await runFlow(
      flow,
      { app: "myapp", app_path: dir, run_dir: runDir },
      { agent: fake, cwd: dir, saagaRules: rules },
    );

    expect(fake.calls).toHaveLength(2);
    for (const call of fake.calls) {
      expect(call.prompt).toContain(rules);
      expect(call.prompt).toContain(".saagarules");
      expect(call.prompt).toContain("HIGH PRIORITY");
    }
  });

  test("original rendered prompt is intact when saagaRules is appended", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-agent-step-"));
    const runDir = join(dir, "run-abc123");

    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
    });

    const flow = parseFlowDefinition({
      name: "test",
      steps: [
        { agent: { prompt: "document-architecture", vars: { app: "myapp" } } },
      ],
    });

    await runFlow(
      flow,
      { app: "myapp", app_path: dir, run_dir: runDir },
      { agent: fake, cwd: dir, saagaRules: "Extra instructions." },
    );

    expect(fake.calls[0].prompt).toContain("Document the Architecture");
    expect(fake.calls[0].prompt).toContain("Extra instructions.");
  });

  test("prompt is unchanged when saagaRules is undefined", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-agent-step-"));
    const runDir = join(dir, "run-abc123");

    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
    });

    const flow = parseFlowDefinition({
      name: "test",
      steps: [
        { agent: { prompt: "document-architecture", vars: { app: "myapp" } } },
      ],
    });

    await runFlow(
      flow,
      { app: "myapp", app_path: dir, run_dir: runDir },
      { agent: fake, cwd: dir },
    );

    expect(fake.calls[0].prompt).not.toContain(".saagarules");
  });
});

describe("rendered prompt archive", () => {
  test("writes each rendered prompt into <run_dir>/prompts/", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-prompt-archive-"));
    const runDir = join(dir, ".saaga-runs", "run-abc123");
    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
    });

    const flow = parseFlowDefinition({
      name: "test",
      steps: [
        {
          agent: {
            prompt: "document-architecture",
            vars: { app: "myapp", docs_dir: "saaga-docs" },
          },
        },
      ],
    });

    await runFlow(
      flow,
      { app: "myapp", app_path: dir, run_dir: runDir },
      { agent: fake, cwd: dir },
    );

    const archived = join(runDir, "prompts", "01-document-architecture.md");
    expect(existsSync(archived)).toBe(true);
    expect(await readFile(archived, "utf8")).toBe(fake.calls[0].prompt);
  });

  test("archives the prompt the agent actually received, .saagarules included", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-prompt-archive-"));
    const runDir = join(dir, ".saaga-runs", "run-abc123");
    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
    });

    const flow = parseFlowDefinition({
      name: "test",
      steps: [
        { agent: { prompt: "document-architecture", vars: { app: "myapp" } } },
      ],
    });

    await runFlow(
      flow,
      { app: "myapp", app_path: dir, run_dir: runDir },
      { agent: fake, cwd: dir, saagaRules: "Always cite line numbers." },
    );

    const archived = await readFile(
      join(runDir, "prompts", "01-document-architecture.md"),
      "utf8",
    );
    expect(archived).toContain("Always cite line numbers.");
    expect(archived).toBe(fake.calls[0].prompt);
  });

  test("gives repeated renders of one prompt distinct filenames", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-prompt-archive-"));
    const runDir = join(dir, ".saaga-runs", "run-abc123");
    const fake = new FakeAgent({
      "Document a Plan Slice": { exitCode: 0 },
    });

    const flow = parseFlowDefinition({
      name: "test",
      steps: [
        {
          foreach: {
            var: "phase",
            in: "${phases}",
            do: [
              {
                agent: {
                  prompt: "slice-doc",
                  vars: {
                    plan: "/run/plan.md",
                    phase_number: "${phase.number}",
                    docs_dir: "saaga-docs",
                  },
                },
              },
            ],
          },
        },
      ],
    });

    await runFlow(
      flow,
      {
        app: "myapp",
        app_path: dir,
        run_dir: runDir,
        phases: [
          { number: 1, title: "One" },
          { number: 2, title: "Two" },
        ],
      },
      { agent: fake, cwd: dir },
    );

    const written = (await readdir(join(runDir, "prompts"))).sort();
    expect(written).toEqual([
      "01-slice-doc-phase1.md",
      "02-slice-doc-phase2.md",
    ]);
  });

  test("runs fine when the flow has no run_dir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-prompt-archive-"));
    const fake = new FakeAgent({
      "Document the Architecture": { exitCode: 0 },
    });

    const flow = parseFlowDefinition({
      name: "test",
      steps: [
        { agent: { prompt: "document-architecture", vars: { app: "myapp" } } },
      ],
    });

    await expect(
      runFlow(flow, { app: "myapp", app_path: dir }, { agent: fake, cwd: dir }),
    ).resolves.toBeUndefined();
    expect(fake.calls).toHaveLength(1);
  });
});

describe("prompt archive naming inside a verify/fix loop", () => {
  test("labels each render with its phase and loop iteration", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saaga-prompt-archive-"));
    const runDir = join(dir, ".saaga-runs", "run-abc123");
    const fake = new FakeAgent({
      "Verify Domain Documentation Slice": {
        exitCode: 0,
        effect: async (_opts, prompt) => {
          const m = prompt.match(/Write the verification status to `([^`]+)`/);
          if (!m) throw new Error("status path not found");
          await mkdir(dirname(m[1]), { recursive: true });
          // Fail the first pass so the loop runs twice.
          const iteration = m[1].endsWith("status-1.txt") ? "FAIL" : "PASS";
          await writeFile(m[1], iteration, "utf8");
        },
      },
    });

    const flow = parseFlowDefinition({
      name: "test",
      steps: [
        {
          loop: {
            max: 3,
            until: '${status} == "PASS"',
            do: [
              {
                agent: {
                  prompt: "verify-domain-documentation",
                  vars: {
                    plan: "/run/plan.md",
                    phase_number: "2",
                    review_path: "${run_dir}/slice-2/review-${iteration}.md",
                    status_path: "${run_dir}/slice-2/status-${iteration}.txt",
                    changes_dir: "none",
                    docs_dir: "saaga-docs",
                  },
                },
              },
              {
                "read-file": {
                  path: "${run_dir}/slice-2/status-${iteration}.txt",
                  set: "status",
                  trim: true,
                },
              },
            ],
          },
        },
      ],
    });

    await runFlow(
      flow,
      { app: "myapp", app_path: dir, run_dir: runDir },
      { agent: fake, cwd: dir },
    );

    const written = (await readdir(join(runDir, "prompts"))).sort();
    expect(written).toEqual([
      "01-verify-domain-documentation-phase2-iter1.md",
      "02-verify-domain-documentation-phase2-iter2.md",
    ]);
  });
});
