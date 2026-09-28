import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import { execa } from "execa";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { runCli } from "../../src/cli.js";
import { runFlow } from "../../src/engine/runner.js";
import { readManifest, writeManifest } from "../../src/run-manifest.js";

vi.mock("execa", () => ({ execa: vi.fn() }));
vi.mock("../../src/engine/runner.js", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/engine/runner.js")>(), runFlow: vi.fn(),
}));
vi.mock("../../src/doctor/preflight.js", () => ({
  runPreflight: vi.fn(async () => ({ passed: true })),
}));

const mockRunFlow = vi.mocked(runFlow);
const mockExeca = vi.mocked(execa);
let output: string;
let sink: Writable;

beforeEach(() => {
  mockRunFlow.mockReset();
  mockExeca.mockReset();
  mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);
  output = "";
  sink = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done(); } });
});

async function project(fast?: boolean) {
  const app = await mkdtemp(join(tmpdir(), "saaga-codex-options-"));
  await mkdir(join(app, ".saaga"));
  await writeFile(join(app, ".saaga", "config.yaml"),
    `defaultBackend: codex\n${fast === undefined ? "" : `backends:\n  codex:\n    fast: ${fast}\n`}`);
  return app;
}

async function run(app: string, flags: string[] = []) {
  expect(await runCli(["run", "quick-update", app, "--yes", ...flags], { stderr: sink })).toBe(0);
  const deps = mockRunFlow.mock.calls.at(-1)![2];
  await deps.agent.run("test", { cwd: app });
  return mockExeca.mock.calls.at(-1)![1] as string[];
}

describe("Codex CLI options", () => {
  test.each([
    [undefined, [], false], [true, [], true], [false, ["--fast"], true], [true, ["--no-fast"], false],
  ] as const)("config %s flags %s resolves fast %s", async (configFast, flags, expected) => {
    const app = await project(configFast);
    const args = await run(app, [...flags]);
    expect(args).toContain(`service_tier="${expected ? "fast" : "default"}"`);
    expect(mockRunFlow.mock.calls[0][2].models).toEqual({ medium: "gpt-6-sol" });
    expect(output.includes("fast mode is enabled")).toBe(expected);
    const [id] = await readdir(join(app, ".saaga-runs"));
    expect((await readManifest(join(app, ".saaga-runs", id))).fast).toBe(expected);
  });

  test("main workflows resolve to Sol, with an Astra override", async () => {
    const app = await project();
    expect(await runCli(["run", "init", app, "--yes"], { stderr: sink })).toBe(0);
    expect(mockRunFlow.mock.calls.at(-1)![2].models).toEqual({ high: "gpt-6-sol" });
    expect(await runCli(["run", "update", app, "--yes", "--model", "high=gpt-6-astra"], { stderr: sink })).toBe(0);
    expect(mockRunFlow.mock.calls.at(-1)![2].models).toEqual({ high: "gpt-6-astra" });
  });

  test("resumes with the pinned fast setting, and permits an explicit override", async () => {
    const app = await project(true);
    await run(app);
    const [id] = await readdir(join(app, ".saaga-runs"));
    const dir = join(app, ".saaga-runs", id);
    await writeManifest(dir, { ...await readManifest(dir), status: "failed" });
    await writeFile(join(app, ".saaga", "config.yaml"), "defaultBackend: codex\nbackends:\n  codex:\n    fast: false\n");
    for (const flags of [[], ["--no-fast"]]) {
      await writeManifest(dir, { ...await readManifest(dir), status: "failed" });
      expect(await runCli(["run", "--resume", id, app, "--yes", ...flags], { stderr: sink })).toBe(0);
      const deps = mockRunFlow.mock.calls.at(-1)![2];
      await deps.agent.run("test", { cwd: app });
      expect(mockExeca.mock.calls.at(-1)![1]).toContain(`service_tier="${flags.length ? "default" : "fast"}"`);
    }
  });

  test("does not carry Codex fast mode into a resumed Claude run", async () => {
    const app = await project(true);
    await run(app);
    const [id] = await readdir(join(app, ".saaga-runs"));
    const dir = join(app, ".saaga-runs", id);
    await writeManifest(dir, { ...await readManifest(dir), status: "failed" });
    expect(await runCli(["run", "--resume", id, app, "--yes", "--backend", "claude"], { stderr: sink })).toBe(0);
    expect((await readManifest(dir)).fast).toBeUndefined();
  });

  test("rejects fast for other backends before executing a flow", async () => {
    const app = await project();
    await expect(runCli(["run", "update", app, "--backend", "claude", "--fast", "--yes"], { stderr: sink })).rejects.toThrow("require --backend codex");
    expect(mockRunFlow).not.toHaveBeenCalled();
  });
});
