import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Writable } from "node:stream";
import { describe, expect, test } from "vitest";
import { FakeAgent, type FakeScenarioValue } from "../../src/agent/fake-agent.js";
import { runCli } from "../../src/cli.js";
import {
  manifestModels,
  readManifest,
  writeManifest,
  type RunManifest,
} from "../../src/run-manifest.js";

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

async function tmpAppEnv(name: string) {
  const root = await mkdtemp(join(tmpdir(), "saaga-test-"));
  const app = join(root, name);
  await mkdir(app);
  await writeFile(join(app, "README.md"), "x", "utf8");
  return { root, app };
}

const PLAN = `---
phases:
  - number: 0
    title: "Setup Structure"
  - number: 1
    title: "Core Domain"
---

# Plan body
`;

function planInitScenario(): FakeScenarioValue {
  return {
    exitCode: 0,
    effect: async (_opts, prompt) => {
      const m = prompt.match(/Write the plan to `([^`]+)`/);
      if (!m) throw new Error("plan path not found in plan-init prompt");
      await mkdir(dirname(m[1]), { recursive: true });
      await writeFile(m[1], PLAN, "utf8");
    },
  };
}

function verifyScenario(): FakeScenarioValue {
  return {
    exitCode: 0,
    effect: async (_opts, prompt) => {
      const m = prompt.match(/Write the verification status to `([^`]+)`/);
      if (!m) throw new Error("status path not found in verify prompt");
      await mkdir(dirname(m[1]), { recursive: true });
      await writeFile(m[1], "PASS", "utf8");
    },
  };
}

/** A working agent for the whole init flow. */
function healthyAgent(): FakeAgent {
  return new FakeAgent({
    "Document the Architecture": { exitCode: 0 },
    "Plan Domain Documentation": planInitScenario(),
    "Document a Plan Slice": { exitCode: 0 },
    "Verify Domain Documentation Slice": verifyScenario(),
  });
}

function firstLines(agent: FakeAgent): string[] {
  return agent.calls.map((c) => c.prompt.split("\n")[0]);
}

async function onlyRunDir(app: string): Promise<{ id: string; dir: string }> {
  const ids = await readdir(join(app, ".saaga-runs"));
  expect(ids).toHaveLength(1);
  return { id: ids[0], dir: join(app, ".saaga-runs", ids[0]) };
}

/**
 * Runs `saaga run init` and interrupts it, Ctrl+C style, during the first
 * slice-doc step. Returns the run id and what was printed.
 */
async function interruptedInit(app: string) {
  const controller = new AbortController();
  const agent = new FakeAgent({
    "Document the Architecture": { exitCode: 0 },
    "Plan Domain Documentation": planInitScenario(),
    "Document a Plan Slice": { exitCode: 0, effect: () => controller.abort() },
  });
  const err = new StringWritable();
  const exitCode = await runCli(["run", "init", app], {
    agent,
    stderr: err,
    signal: controller.signal,
  });
  const run = await onlyRunDir(app);
  return { exitCode, stderr: err.text, agent, ...run };
}

describe("saaga run --resume", () => {
  test("an interrupted run records its state and prints the resume command", async () => {
    const { app } = await tmpAppEnv("myapp");
    const { exitCode, stderr, agent, id, dir } = await interruptedInit(app);

    expect(exitCode).toBe(130);
    expect(stderr).toContain(`interrupted. To resume: saaga run --resume ${id} ${app}`);
    expect(firstLines(agent)).toEqual([
      "# Document the Architecture of an Application",
      "# Plan Domain Documentation for an Application",
      "# Document a Plan Slice",
    ]);

    const manifest = await readManifest(dir);
    expect(manifest.status).toBe("interrupted");
    expect(manifest.flow).toBe("init");
    expect(manifest.initialScope.run_id).toBe(id);
    const journal = await readFile(join(dir, "steps.jsonl"), "utf8");
    // check-format-version, ensure-gitignore, architecture, plan, parse-plan
    expect(journal.trim().split("\n")).toHaveLength(5);
  });

  test("resumes at the interrupted step and completes", async () => {
    const { app } = await tmpAppEnv("myapp");
    const { id, dir } = await interruptedInit(app);

    const agent = healthyAgent();
    const err = new StringWritable();
    const exitCode = await runCli(["run", "--resume", id, app], { agent, stderr: err });

    expect(exitCode).toBe(0);
    expect(err.text).toContain(`resuming run ${id} (attempt 2, 5 steps already done)`);
    expect(firstLines(agent)).toEqual([
      "# Document a Plan Slice",
      "# Document a Plan Slice",
      "# Verify Domain Documentation Slice",
    ]);
    expect(agent.calls[0].prompt).toContain("earlier attempt of this run was interrupted");
    expect(agent.calls[1].prompt).not.toContain("earlier attempt of this run was interrupted");

    const manifest = await readManifest(dir);
    expect(manifest.status).toBe("completed");
    expect(manifest.resumedAt).toHaveLength(1);
    expect(manifest.initialScope.run_dir).toBe(dir);

    // Prompts of both attempts are kept, numbered consecutively.
    const prompts = (await readdir(join(dir, "prompts"))).sort();
    expect(prompts).toEqual([
      "01-document-architecture.md",
      "02-plan-init.md",
      "03-slice-doc-phase0.md",
      "04-slice-doc-phase0.md",
      "05-slice-doc-phase1.md",
      "06-verify-domain-documentation-phase1-iter1.md",
    ]);
    expect((await readdir(join(app, ".saaga-runs"))).length).toBe(1);
  });

  test("accepts the flow name before --resume and rejects a mismatching one", async () => {
    const { app } = await tmpAppEnv("myapp");
    const { id } = await interruptedInit(app);

    await expect(
      runCli(["run", "update", "--resume", id, app], { agent: healthyAgent() }),
    ).rejects.toThrow(/is a 'init' run, not 'update'/);

    const exitCode = await runCli(["run", "init", "--resume", id, app], {
      agent: healthyAgent(),
      stderr: new StringWritable(),
    });
    expect(exitCode).toBe(0);
  });

  test("a failed run is resumable too", async () => {
    const { app } = await tmpAppEnv("myapp");
    const broken = new FakeAgent({ "Document the Architecture": { exitCode: 1 } });
    const err = new StringWritable();
    const exitCode = await runCli(["run", "init", app], { agent: broken, stderr: err });
    const { id, dir } = await onlyRunDir(app);

    expect(exitCode).toBe(1);
    expect(err.text).toContain(`failed. To resume: saaga run --resume ${id} ${app}`);
    expect((await readManifest(dir)).status).toBe("failed");
    expect((await readManifest(dir)).lastError).toMatch(/exited with code 1/);

    const agent = healthyAgent();
    expect(
      await runCli(["run", "--resume", id, app], { agent, stderr: new StringWritable() }),
    ).toBe(0);
    expect(firstLines(agent)[0]).toBe("# Document the Architecture of an Application");
    expect((await readManifest(dir)).status).toBe("completed");
    expect((await readManifest(dir)).lastError).toBeUndefined();
  });

  test("refuses completed, unknown and changed-flow runs", async () => {
    const { app } = await tmpAppEnv("myapp");
    const { id, dir } = await interruptedInit(app);

    await expect(
      runCli(["run", "--resume", "nope-init-20260101-000000-00000000", app], {
        agent: healthyAgent(),
      }),
    ).rejects.toThrow(/run 'nope-init-20260101-000000-00000000' not found/);

    const manifest = await readManifest(dir);
    await writeManifest(dir, { ...manifest, flowHash: "stale" });
    await expect(
      runCli(["run", "--resume", id, app], { agent: healthyAgent() }),
    ).rejects.toThrow(/flow 'init' has changed since run/);
    await writeManifest(dir, manifest);

    expect(
      await runCli(["run", "--resume", id, app], {
        agent: healthyAgent(),
        stderr: new StringWritable(),
      }),
    ).toBe(0);
    await expect(
      runCli(["run", "--resume", id, app], { agent: healthyAgent() }),
    ).rejects.toThrow(/already completed/);
  });

  test("a run left as running by a dead process resumes with a warning", async () => {
    const { app } = await tmpAppEnv("myapp");
    const { id, dir } = await interruptedInit(app);
    const manifest = await readManifest(dir);
    await writeManifest(dir, { ...manifest, status: "running", pid: 2 ** 22 - 1 });

    const err = new StringWritable();
    expect(
      await runCli(["run", "--resume", id, app], { agent: healthyAgent(), stderr: err }),
    ).toBe(0);
    expect(err.text).toContain("no longer exists; resuming");
  });

  test("--resume and --continue cannot be combined", async () => {
    const { app } = await tmpAppEnv("myapp");
    await expect(
      runCli(["run", "--resume", "x", "--continue", app], { agent: healthyAgent() }),
    ).rejects.toThrow(/cannot be combined/);
  });
});

describe("saaga run --continue", () => {
  test("picks the most recent resumable run", async () => {
    const { app } = await tmpAppEnv("myapp");
    const { id } = await interruptedInit(app);

    const agent = healthyAgent();
    const err = new StringWritable();
    expect(await runCli(["run", "--continue", app], { agent, stderr: err })).toBe(0);
    expect(err.text).toContain(`resuming run ${id}`);
    expect(firstLines(agent)[0]).toBe("# Document a Plan Slice");
  });

  test("filters by flow when one is named", async () => {
    const { app } = await tmpAppEnv("myapp");
    await interruptedInit(app);
    await expect(
      runCli(["run", "update", "--continue", app], { agent: healthyAgent() }),
    ).rejects.toThrow(/no resumable 'update' run found/);
    expect(
      await runCli(["run", "init", "--continue", app], {
        agent: healthyAgent(),
        stderr: new StringWritable(),
      }),
    ).toBe(0);
  });

  test("errors when there is nothing to resume", async () => {
    const { app } = await tmpAppEnv("myapp");
    await expect(
      runCli(["run", "--continue", app], { agent: healthyAgent() }),
    ).rejects.toThrow(/no resumable run found/);
  });
});

describe("manifestModels", () => {
  const base = {
    runId: "r",
    flow: "quick-update",
    flowHash: "h",
    app: "a",
    appPath: "/a",
    docsDir: "d",
    initialScope: {},
    status: "interrupted",
    pid: 1,
    startedAt: "now",
    resumedAt: [],
  } as unknown as RunManifest;

  test("returns the recorded map", () => {
    expect(manifestModels({ ...base, models: { high: "opus" } })).toEqual({
      high: "opus",
    });
  });

  /**
   * Adding `model:` to a flow changes its hash, so the only flows that can
   * still resume across the upgrade are the untouched ones — which are
   * exactly the ones that ran on the default key.
   */
  test("reads a pre-per-step pin as the default key", () => {
    expect(manifestModels({ ...base, model: "legacy-pin" })).toEqual({
      medium: "legacy-pin",
    });
  });

  test("prefers the map when a manifest somehow carries both", () => {
    expect(
      manifestModels({ ...base, model: "legacy", models: { low: "haiku" } }),
    ).toEqual({ low: "haiku" });
  });

  test("is undefined when the run pinned nothing", () => {
    expect(manifestModels(base)).toBeUndefined();
  });
});
