import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("execa", () => {
  const mockExeca = vi.fn();
  return { execa: mockExeca };
});

import { execa } from "execa";
import { ClaudeAgent } from "../../src/agent/claude-agent.js";

const mockExeca = vi.mocked(execa);

describe("ClaudeAgent", () => {
  beforeEach(() => {
    mockExeca.mockReset();
  });
  afterEach(() => {
    mockExeca.mockReset();
  });

  test("spawns claude with correct flags and propagates exit code", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);

    const cwd = await mkdtemp(join(tmpdir(), "claude-agent-"));
    const agent = new ClaudeAgent({ model: "opus" });
    const result = await agent.run("Document the architecture", { cwd });

    expect(mockExeca).toHaveBeenCalledOnce();
    const [bin, args, opts] = mockExeca.mock.calls[0] as any[];
    expect(bin).toBe("claude");
    expect(args).toEqual([
      "--print",
      "--dangerously-skip-permissions",
      "--model",
      "opus",
      "Document the architecture",
    ]);
    expect(opts.cwd).toBe(cwd);
    expect(opts.reject).toBe(false);
    expect(opts.stdio).toBe("inherit");

    expect(result.exitCode).toBe(0);
  });

  test("propagates non-zero exit code", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 7 }) as any);
    const cwd = await mkdtemp(join(tmpdir(), "claude-agent-"));
    const agent = new ClaudeAgent({ model: "sonnet" });
    const result = await agent.run("p", { cwd });
    expect(result.exitCode).toBe(7);
  });

  test("returns exitCode 1 on spawn failure", async () => {
    mockExeca.mockImplementation(() => {
      throw new Error("spawn ENOENT");
    });
    const cwd = await mkdtemp(join(tmpdir(), "claude-agent-"));
    const agent = new ClaudeAgent({ model: "opus" });
    const result = await agent.run("p", { cwd });
    expect(result.exitCode).toBe(1);
  });

  test("forwards AbortSignal to execa", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);
    const cwd = await mkdtemp(join(tmpdir(), "claude-agent-"));
    const controller = new AbortController();
    const agent = new ClaudeAgent({ model: "opus" });
    await agent.run("p", { cwd, signal: controller.signal });

    const [, , opts] = mockExeca.mock.calls[0] as any[];
    expect(opts.signal).toBe(controller.signal);
  });
});

describe("backend selector picks ClaudeAgent for backend=claude", () => {
  test("createAgent returns a ClaudeAgent instance for backend: 'claude'", async () => {
    const { createAgent } = await import("../../src/cli/backend.js");
    const agent = createAgent({ backend: "claude", model: "opus" });
    expect(agent.name).toBe("claude");
  });
});
