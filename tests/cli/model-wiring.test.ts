import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Mocked so the flow never executes: this asserts the wiring between model
// resolution and the runner, and stubbing the runner is what keeps a real,
// billed agent from being spawned by a test that resolves a real backend.
vi.mock("../../src/engine/runner.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../src/engine/runner.js")
  >();
  return { ...actual, runFlow: vi.fn() };
});

// Preflight probes the backend CLI, which need not exist on this machine.
vi.mock("../../src/doctor/preflight.js", () => ({
  runPreflight: vi.fn(async () => ({ passed: true, results: [] })),
}));

import { runCli } from "../../src/cli.js";
import { runFlow } from "../../src/engine/runner.js";

const mockRunFlow = vi.mocked(runFlow);

class StringWritable extends Writable {
  private chunks: string[] = [];
  override _write(
    chunk: Buffer | string,
    _enc: string,
    cb: (e?: Error | null) => void,
  ): void {
    this.chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    cb();
  }
  get text(): string {
    return this.chunks.join("");
  }
}

async function tmpApp(configYaml: string): Promise<string> {
  const app = await mkdtemp(join(tmpdir(), "saaga-model-wiring-"));
  await mkdir(join(app, ".saaga"), { recursive: true });
  await writeFile(join(app, ".saaga", "config.yaml"), configYaml, "utf8");
  await writeFile(join(app, "README.md"), "# app\n", "utf8");
  return app;
}

/** The `models` map handed to `runFlow` for a flow, via real resolution. */
async function modelsFor(
  flow: string,
  configYaml: string,
  extraArgs: string[] = [],
): Promise<Record<string, string> | undefined> {
  const app = await tmpApp(configYaml);
  await runCli(["run", flow, app, "--yes", ...extraArgs], {
    stderr: new StringWritable(),
  });

  expect(mockRunFlow).toHaveBeenCalled();
  const deps = mockRunFlow.mock.calls[0][2];
  return deps.models;
}

describe("per-step model keys reach the runner", () => {
  beforeEach(() => {
    mockRunFlow.mockReset();
  });

  const CLAUDE = "defaultBackend: claude\n";

  /**
   * The regression this file exists for: dropping `models` from the runFlow
   * deps leaves every step on the agent's constructor model, which makes the
   * whole feature silently inert while every other test still passes.
   */
  test("update's high-tier steps resolve to the high model", async () => {
    expect(await modelsFor("update", CLAUDE)).toEqual({ high: "opus" });
  });

  test("quick-update takes the medium default", async () => {
    expect(await modelsFor("quick-update", CLAUDE)).toEqual({
      medium: "sonnet",
    });
  });

  test("--model remaps the key the steps ask for", async () => {
    expect(
      await modelsFor("update", CLAUDE, ["--model", "high=cheapo"]),
    ).toEqual({ high: "cheapo" });
  });

  test("config models are honoured", async () => {
    expect(
      await modelsFor(
        "update",
        "defaultBackend: claude\nbackends:\n  claude:\n    models:\n      high: config-high\n",
      ),
    ).toEqual({ high: "config-high" });
  });
});
