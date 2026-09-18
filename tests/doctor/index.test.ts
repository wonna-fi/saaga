import { describe, expect, test } from "vitest";
import { unknownModelOutcome } from "../../src/doctor/index.js";

const MODEL = "saaga-nonexistent-model-probe-00000";

describe("unknownModelOutcome", () => {
  test("a non-zero exit that names the model means the CLI rejected it", () => {
    // Captured from copilot.
    const err = { status: 1, stderr: `Error: Model "${MODEL}" from --model flag is not available.\n` };
    expect(unknownModelOutcome("copilot", err, MODEL)).toEqual({ status: "pass", exitCode: 1 });
  });

  test("a login failure exits non-zero too, but is not a rejection", () => {
    // Captured from claude and cursor when not logged in.
    for (const [backend, stderr] of [
      ["claude", "Invalid API key · Please run /login\n"],
      ["cursor", "Error: Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable.\n"],
    ] as const) {
      const outcome = unknownModelOutcome(backend, { status: 1, stderr }, MODEL);
      expect(outcome.status, backend).toBe("fail");
      expect(outcome.error).toContain(stderr.trim());
    }
  });

  test("a rejected kiro API key is quoted from among kiro's log noise", () => {
    // Captured from kiro-cli with an invalid KIRO_API_KEY.
    const stderr = [
      "[INFO] kas.server.starting {\"product\":\"KAS (Kiro Agent Server)\"}",
      "[ERROR] [KRS] HTTP 403 requestId=abc body={...}",
      "",
      "Error: Access denied. Please check your authentication. (Request ID: abc)",
      "",
    ].join("\n");
    const outcome = unknownModelOutcome("kiro", { status: 1, stderr: Buffer.from(stderr) }, MODEL);
    expect(outcome.status).toBe("fail");
    expect(outcome.error).toMatch(/Access denied\. Please check your authentication/);
  });

  test("exit 0 means the bogus model was accepted", () => {
    expect(unknownModelOutcome("claude", { status: 0 }, MODEL).status).toBe("fail");
  });

  test("a timeout is not a rejection, and for kiro points at the login", () => {
    // What execFileSync throws when it kills the child at its timeout.
    const outcome = unknownModelOutcome("kiro", { status: null, signal: "SIGTERM", code: "ETIMEDOUT" }, MODEL);
    expect(outcome.status).toBe("fail");
    expect(outcome.error).toMatch(/timed out/);
    expect(outcome.error).toMatch(/kiro-cli logged in/);
  });

  test("a signal or a failed spawn is not a rejection either", () => {
    expect(unknownModelOutcome("cursor", { status: null, signal: "SIGKILL" }, MODEL).status).toBe("fail");
    const missing = unknownModelOutcome("copilot", { code: "ENOENT" }, MODEL);
    expect(missing.status).toBe("fail");
    expect(missing.error).toMatch(/ENOENT/);
    expect(missing.error).not.toMatch(/kiro/);
  });
});
