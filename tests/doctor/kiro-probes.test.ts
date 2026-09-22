import { describe, expect, test } from "vitest";
import { runKiroAccountProbes, type KiroCommandResult } from "../../src/doctor/kiro-probes.js";

const LOGGED_IN = { exitCode: 0, stdout: '{"accountType":"SocialGoogle","email":"a@b.c"}' };
// Output of kiro-cli 2.22.0 after `kiro-cli logout`.
const LOGGED_OUT = { exitCode: 1, stdout: '{"account":null}' };
const MODELS = {
  exitCode: 0,
  stdout: JSON.stringify({
    models: [{ model_id: "auto" }, { model_id: "claude-haiku-4.5" }, { model_id: "claude-sonnet-4.5" }],
    default_model: "auto",
  }),
};

/** A fake kiro-cli answering `whoami` and `--list-models`, recording calls. */
function fakeKiro(whoami: KiroCommandResult, listModels: KiroCommandResult = MODELS) {
  const calls: string[][] = [];
  const run = (args: readonly string[]): KiroCommandResult => {
    calls.push([...args]);
    return args[0] === "whoami" ? whoami : listModels;
  };
  return { run, calls };
}

const BOTH = ["kiro/auth", "kiro/models-available"];

function statuses(results: { probeId: string; status: string }[]) {
  return Object.fromEntries(results.map((r) => [r.probeId, r.status]));
}

describe("kiro/auth", () => {
  test("passes for a logged-in account of any type", () => {
    for (const accountType of ["SocialGoogle", "BuilderId", "IamIdentityCenter", "ExternalIdp"]) {
      const { run } = fakeKiro({ exitCode: 0, stdout: JSON.stringify({ accountType }) });
      const [result] = runKiroAccountProbes({ probeIds: ["kiro/auth"], models: [], env: {}, run });
      expect(result.status).toBe("pass");
    }
  });

  test("does not leak the account email into the result", () => {
    const { run } = fakeKiro(LOGGED_IN);
    const [result] = runKiroAccountProbes({ probeIds: ["kiro/auth"], models: [], env: {}, run });
    expect(JSON.stringify(result)).not.toContain("a@b.c");
  });

  test("fails for the real logged-out output", () => {
    const { run } = fakeKiro(LOGGED_OUT);
    const [result] = runKiroAccountProbes({ probeIds: ["kiro/auth"], models: [], env: {}, run });
    expect(result.status).toBe("fail");
    expect(result.error).toMatch(/kiro-cli login/);
  });

  test("fails on exit 0 without an account type", () => {
    for (const stdout of ["Not logged in", "null", "{}", ""]) {
      const { run } = fakeKiro({ exitCode: 0, stdout });
      const [result] = runKiroAccountProbes({ probeIds: ["kiro/auth"], models: [], env: {}, run });
      expect(result.status, stdout).toBe("fail");
    }
  });
});

describe("kiro/models-available", () => {
  test("passes when every model is on the plan", () => {
    const { run } = fakeKiro(LOGGED_IN);
    const results = runKiroAccountProbes({
      probeIds: BOTH,
      models: ["claude-haiku-4.5", "claude-sonnet-4.5", "claude-sonnet-4.5"],
      env: {},
      run,
    });
    expect(statuses(results)).toEqual({ "kiro/auth": "pass", "kiro/models-available": "pass" });
  });

  test("names each missing model and the override", () => {
    const { run } = fakeKiro(LOGGED_IN);
    const [, result] = runKiroAccountProbes({
      probeIds: BOTH,
      models: ["claude-haiku-4.5", "claude-opus-4.5"],
      env: {},
      run,
    });
    expect(result.status).toBe("fail");
    expect(result.error).toContain("'claude-opus-4.5'");
    expect(result.error).not.toContain("'claude-haiku-4.5'");
    expect(result.error).toContain("--model <key>=<model>");
  });

  test("is skipped without listing models when the login check fails", () => {
    // Listing models while logged out can start the browser login too.
    const { run, calls } = fakeKiro(LOGGED_OUT);
    const results = runKiroAccountProbes({ probeIds: BOTH, models: ["m"], env: {}, run });
    expect(statuses(results)).toEqual({ "kiro/auth": "fail", "kiro/models-available": "skip" });
    expect(calls.some((c) => c.includes("--list-models"))).toBe(false);
  });

  test("fails when the list holds only the auto fallback", () => {
    const { run } = fakeKiro(LOGGED_IN, {
      exitCode: 0,
      stdout: '{"models":[{"model_id":"auto"}]}',
    });
    const [, result] = runKiroAccountProbes({ probeIds: BOTH, models: ["m"], env: {}, run });
    expect(result.status).toBe("fail");
  });

  test("fails when the model list cannot be read", () => {
    const { run } = fakeKiro(LOGGED_IN, { exitCode: 1, stdout: "" });
    const [, result] = runKiroAccountProbes({ probeIds: BOTH, models: ["m"], env: {}, run });
    expect(result.status).toBe("fail");
  });
});

describe("with KIRO_API_KEY set", () => {
  const KEY = { KIRO_API_KEY: "k" };
  // With a key and no stored login, whoami reports the key without
  // validating it.
  const KEY_ACCOUNT = { exitCode: 0, stdout: '{"accountType":"ApiKey","email":null}' };
  // Logged out with a rejected key, --list-models prints this and exits 0.
  const FALLBACK_ONLY = {
    exitCode: 0,
    stdout: '{"models":[{"model_name":"auto","model_id":"auto"}],"default_model":"auto"}',
  };

  test("key account: a key that lists real models passes, and the run's models are checked", () => {
    const { run } = fakeKiro(KEY_ACCOUNT, MODELS);
    const results = runKiroAccountProbes({
      probeIds: BOTH,
      models: ["claude-haiku-4.5", "claude-opus-4.5"],
      env: KEY,
      run,
    });
    expect(statuses(results)).toEqual({ "kiro/auth": "pass", "kiro/models-available": "fail" });
    expect(results[1].error).toContain("'claude-opus-4.5'");
  });

  test("key account: lists models once for both probes", () => {
    const { run, calls } = fakeKiro(KEY_ACCOUNT, MODELS);
    runKiroAccountProbes({ probeIds: BOTH, models: ["claude-haiku-4.5"], env: KEY, run });
    expect(calls.filter((c) => c.includes("--list-models"))).toHaveLength(1);
  });

  test("key account: a key that yields only the auto fallback is reported as rejected", () => {
    const { run } = fakeKiro(KEY_ACCOUNT, FALLBACK_ONLY);
    const results = runKiroAccountProbes({ probeIds: BOTH, models: ["m"], env: KEY, run });
    expect(statuses(results)).toEqual({ "kiro/auth": "fail", "kiro/models-available": "skip" });
    expect(results[0].error).toMatch(/KIRO_API_KEY was not accepted/);
    expect(results[0].error).toMatch(/whitespace/);
  });

  test("tolerates a kiro that reports no account type with a key set", () => {
    const { run } = fakeKiro(LOGGED_OUT, MODELS);
    const results = runKiroAccountProbes({ probeIds: BOTH, models: ["claude-haiku-4.5"], env: KEY, run });
    expect(statuses(results)).toEqual({ "kiro/auth": "pass", "kiro/models-available": "pass" });
  });

  test("also logged in: both skip, since kiro answers from the login", () => {
    const { run, calls } = fakeKiro(LOGGED_IN, MODELS);
    const results = runKiroAccountProbes({ probeIds: BOTH, models: ["m"], env: KEY, run });
    expect(statuses(results)).toEqual({ "kiro/auth": "skip", "kiro/models-available": "skip" });
    expect(results[0].error).toMatch(/level full/);
    expect(calls.some((c) => c.includes("--list-models"))).toBe(false);
  });
});

test("no probe ids runs nothing", () => {
  const { run, calls } = fakeKiro(LOGGED_IN);
  expect(runKiroAccountProbes({ probeIds: [], models: ["m"], env: {}, run })).toEqual([]);
  expect(calls).toEqual([]);
});
