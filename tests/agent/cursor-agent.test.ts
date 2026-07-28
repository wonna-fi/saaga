import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("execa", () => {
  const mockExeca = vi.fn();
  return { execa: mockExeca };
});

import { execa } from "execa";
import { CursorAgent } from "../../src/agent/cursor-agent.js";

const mockExeca = vi.mocked(execa);

describe("CursorAgent", () => {
  beforeEach(() => {
    mockExeca.mockReset();
  });
  test("spawns cursor-agent with correct flags and propagates exit code", async () => {
    mockExeca.mockReturnValue(
      Promise.resolve({ exitCode: 0 }) as any,
    );

    const agent = new CursorAgent({ model: "claude-4.6-opus-high-thinking" });
    const result = await agent.run("Document the architecture", {
      cwd: "/tmp/myapp",
    });

    expect(mockExeca).toHaveBeenCalledOnce();
    const [bin, args, opts] = mockExeca.mock.calls[0] as any[];

    expect(bin).toBe("cursor-agent");
    expect(args).toEqual([
      "--print",
      "--force",
      "--model",
      "claude-4.6-opus-high-thinking",
      "--output-format",
      "text",
      "Document the architecture",
    ]);
    expect(opts.cwd).toBe("/tmp/myapp");
    expect(opts.reject).toBe(false);

    expect(result.exitCode).toBe(0);
  });

  test("always includes --output-format text regardless of ci flag", async () => {
    mockExeca.mockReturnValue(
      Promise.resolve({ exitCode: 0 }) as any,
    );

    const agent = new CursorAgent({ model: "m" });
    await agent.run("verify docs", { cwd: "/app" });

    const [, args] = mockExeca.mock.calls[0] as any[];
    expect(args).toContain("--output-format");
    expect(args).toContain("text");
  });

  test("propagates non-zero exit code", async () => {
    mockExeca.mockReturnValue(
      Promise.resolve({ exitCode: 1 }) as any,
    );

    const agent = new CursorAgent({ model: "gpt-5.5-high" });
    const result = await agent.run("fail prompt", { cwd: "/app" });

    expect(result.exitCode).toBe(1);
  });

  test("prompt is always the last argument", async () => {
    mockExeca.mockReturnValue(
      Promise.resolve({ exitCode: 0 }) as any,
    );

    const agent = new CursorAgent({ model: "m", ci: true });
    await agent.run("my long prompt text", { cwd: "/x" });

    const [, args] = mockExeca.mock.calls[0] as any[];
    expect(args[args.length - 1]).toBe("my long prompt text");
  });

  test("sets cwd on the spawned process", async () => {
    mockExeca.mockReturnValue(
      Promise.resolve({ exitCode: 0 }) as any,
    );

    const agent = new CursorAgent({ model: "m" });
    await agent.run("p", { cwd: "/specific/dir" });

    const [, , opts] = mockExeca.mock.calls[0] as any[];
    expect(opts.cwd).toBe("/specific/dir");
  });

  test("uses file target when logFile is provided", async () => {
    mockExeca.mockReturnValue(
      Promise.resolve({ exitCode: 0 }) as any,
    );

    const agent = new CursorAgent({ model: "m" });
    await agent.run("p", { cwd: "/app", logFile: "/tmp/run.log" });

    const [, , opts] = mockExeca.mock.calls[0] as any[];
    expect(opts.stdout).toEqual({ file: "/tmp/run.log", append: true });
    expect(opts.stderr).toEqual({ file: "/tmp/run.log", append: true });
    expect(opts.stdio).toBeUndefined();
  });

  test("uses both inherit and file when logFile + echo", async () => {
    mockExeca.mockReturnValue(
      Promise.resolve({ exitCode: 0 }) as any,
    );

    const agent = new CursorAgent({ model: "m" });
    await agent.run("p", { cwd: "/app", logFile: "/tmp/run.log", echo: true });

    const [, , opts] = mockExeca.mock.calls[0] as any[];
    expect(opts.stdout).toEqual(["inherit", { file: "/tmp/run.log", append: true }]);
    expect(opts.stderr).toEqual(["inherit", { file: "/tmp/run.log", append: true }]);
  });

  test("uses stdio inherit when no logFile", async () => {
    mockExeca.mockReturnValue(
      Promise.resolve({ exitCode: 0 }) as any,
    );

    const agent = new CursorAgent({ model: "m" });
    await agent.run("p", { cwd: "/app" });

    const [, , opts] = mockExeca.mock.calls[0] as any[];
    expect(opts.stdio).toBe("inherit");
  });
});
