import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("execa", () => {
  const mockExeca = vi.fn();
  return { execa: mockExeca };
});

import { execa } from "execa";
import { CopilotAgent } from "../../src/agent/copilot-agent.js";

const mockExeca = vi.mocked(execa);

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe("CopilotAgent", () => {
  beforeEach(() => {
    mockExeca.mockReset();
  });
  afterEach(() => {
    mockExeca.mockReset();
  });

  test("spawns copilot with correct flags and propagates exit code", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);

    const cwd = await mkdtemp(join(tmpdir(), "copilot-agent-"));
    const agent = new CopilotAgent({ model: "claude-sonnet-4.5" });
    const result = await agent.run("Document the architecture", { cwd });

    expect(mockExeca).toHaveBeenCalledOnce();
    const [bin, args, opts] = mockExeca.mock.calls[0] as any[];
    expect(bin).toBe("copilot");
    expect(args).toEqual([
      "-p",
      "Document the architecture",
      "--allow-all-tools",
      "--no-ask-user",
      "--model",
      "claude-sonnet-4.5",
      "--no-auto-update",
    ]);
    expect(opts.cwd).toBe(cwd);
    expect(opts.reject).toBe(false);

    expect(result.exitCode).toBe(0);
  });

  test("propagates non-zero exit code", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 7 }) as any);
    const cwd = await mkdtemp(join(tmpdir(), "copilot-agent-"));
    const agent = new CopilotAgent({ model: "m" });
    const result = await agent.run("p", { cwd });
    expect(result.exitCode).toBe(7);
  });

  test("renames .gitignore to .gitignore.bak before run() and restores after", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "copilot-agent-"));
    const giPath = join(cwd, ".gitignore");
    const originalGitignore = "node_modules\n";
    await writeFile(giPath, originalGitignore, "utf8");

    let observedDuringRun = "MISSING";
    mockExeca.mockImplementation(async () => {
      if (await pathExists(giPath)) {
        observedDuringRun = await readFile(giPath, "utf8");
      } else {
        observedDuringRun = "GONE";
      }
      return { exitCode: 0 } as any;
    });

    const agent = new CopilotAgent({ model: "m" });
    await agent.run("hello", { cwd });

    expect(observedDuringRun).toBe("GONE");

    expect(await pathExists(giPath)).toBe(true);
    expect(await pathExists(join(cwd, ".gitignore.bak"))).toBe(false);
    const restored = await readFile(giPath, "utf8");
    expect(restored).toBe(originalGitignore);
  });

  test("restores .gitignore even when run() throws", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "copilot-agent-"));
    const giPath = join(cwd, ".gitignore");
    const originalGitignore = "build/\n";
    await writeFile(giPath, originalGitignore, "utf8");

    mockExeca.mockImplementation(() => {
      throw new Error("spawn failed");
    });

    const agent = new CopilotAgent({ model: "m" });
    await expect(agent.run("p", { cwd })).rejects.toThrow(/spawn failed/);

    expect(await pathExists(giPath)).toBe(true);
    expect(await pathExists(join(cwd, ".gitignore.bak"))).toBe(false);
    const restored = await readFile(giPath, "utf8");
    expect(restored).toBe(originalGitignore);
  });

  test("no-ops .gitignore handling when no .gitignore is present", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "copilot-agent-"));
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);

    const agent = new CopilotAgent({ model: "m" });
    const result = await agent.run("p", { cwd });

    expect(result.exitCode).toBe(0);
    expect(await pathExists(join(cwd, ".gitignore"))).toBe(false);
    expect(await pathExists(join(cwd, ".gitignore.bak"))).toBe(false);
  });

  test("does not clobber a pre-existing .gitignore.bak file", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "copilot-agent-"));
    const giPath = join(cwd, ".gitignore");
    const giBakPath = join(cwd, ".gitignore.bak");
    const originalGitignore = "node_modules\n";
    const userBackupContent = "# user's own backup\ndist/\n";
    await writeFile(giPath, originalGitignore, "utf8");
    await writeFile(giBakPath, userBackupContent, "utf8");

    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);

    const agent = new CopilotAgent({ model: "m" });
    await agent.run("hello", { cwd });

    // Original .gitignore is restored
    expect(await readFile(giPath, "utf8")).toBe(originalGitignore);
    // User's pre-existing .gitignore.bak is untouched
    expect(await readFile(giBakPath, "utf8")).toBe(userBackupContent);
  });
});

describe("backend selector picks CopilotAgent for backend=copilot", () => {
  test("createAgent returns a CopilotAgent instance for backend: 'copilot'", async () => {
    const { createAgent } = await import("../../src/cli/backend.js");
    const agent = createAgent({ backend: "copilot", model: "m" });
    expect(agent.name).toBe("copilot");
  });
});
