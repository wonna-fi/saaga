import { execFileSync } from "node:child_process";

import { beforeEach, describe, expect, test, vi } from "vitest";

import { runDoctor } from "../../src/doctor/index.js";
import { runFullSideEffectProbes } from "../../src/doctor/full-probes.js";
import { REQUIRED_CLI_FLAGS } from "../../src/doctor/required-flags.js";
import { PROBE_CATALOGUE } from "../../src/doctor/probes.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("../../src/doctor/full-probes.js", () => ({ runFullSideEffectProbes: vi.fn(async () => []) }));
const mockExec = vi.mocked(execFileSync);

beforeEach(() => {
  mockExec.mockReset();
  mockExec.mockImplementation((_file, args) => {
    if ((args as string[])?.includes("--help")) return Buffer.from(REQUIRED_CLI_FLAGS.codex.join("\n"));
    return Buffer.from("codex-cli 0.155.0\n");
  });
});

describe("Codex doctor", () => {
  test("checks exec help, without invoking a model in fast preflight", async () => {
    const result = await runDoctor({ backend: "codex", level: "fast" });
    expect(result.exitCode).toBe(0);
    expect(mockExec).toHaveBeenCalledWith("codex", ["exec", "--help"], expect.anything());
    expect(mockExec.mock.calls.some(([, args]) => (args as string[])?.includes("--model"))).toBe(false);
    expect(result.backends[0].probes.find(p => p.probeId === "unknown-model-fails")?.status).toBe("skip");
  });

  test("fails preflight when permission isolation flags are absent", async () => {
    mockExec.mockImplementation((_file, args) => Buffer.from((args as string[])?.includes("--help") ? "--model --json" : "codex-cli old"));
    const result = await runDoctor({ backend: "codex", level: "fast" });
    expect(result.exitCode).toBe(1);
    expect(result.backends[0].probes.find(p => p.probeId === "required-flags")?.error).toContain("--ignore-user-config");
  });

  test.each([
    ["The requested model does not exist", 1, "pass"],
    ["The requested model does not exist", 0, "fail"],
    ["The requested model does not exist", null, "fail"],
    ["Not logged in", 1, "fail"],
    ["model: saaga-nonexistent-model-probe-00000\nNot logged in", 1, "fail"],
    ["Connection timed out", null, "fail"],
    ["unknown field in config", 1, "fail"],
  ])("bogus model result %s is %s", async (message, status, expected) => {
    mockExec.mockImplementation((_file, args) => {
      if ((args as string[])?.includes("--model")) throw Object.assign(new Error(String(message)), { status, stderr: Buffer.from(String(message)) });
      return Buffer.from("codex-cli 0.155.0");
    });
    const result = await runDoctor({ backend: "codex", level: "full", probe: ["unknown-model-fails"], cwd: "/tmp/saaga-codex-doctor-tests" });
    expect(result.backends[0].probes[0].status).toBe(expected);
    const args = mockExec.mock.calls.find(([, args]) => (args as string[])?.includes("--model"))![1];
    expect(args).toContain("--ignore-user-config");
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  test("includes Codex in every generic guardrail probe", () => {
    for (const id of ["write-source-denied", "rule-files-denied", "baseline-denied", "restricted-shell-utility-allowed", "read-only-git-allowed", "git-mutation-denied"]) {
      expect(PROBE_CATALOGUE.find(p => p.id === id)?.backends).toContain("codex");
    }
  });

  test("constructs the Codex agent for full probes using configured fast mode", async () => {
    await runDoctor({ backend: "codex", level: "full", probe: ["handshake"],
      backendModels: { codex: { fast: true, models: { low: "custom-luna" } } }, cwd: "/tmp/saaga-codex-doctor-tests" });
    expect(vi.mocked(runFullSideEffectProbes).mock.calls.at(-1)![0].agent).toMatchObject({ name: "codex", opts: { model: "custom-luna", fast: true } });
  });
});
