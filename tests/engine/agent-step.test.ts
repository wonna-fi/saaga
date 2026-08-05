import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
      shell: "read-only-git",
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
      shell: "read-only-git",
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
