import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("execa", () => {
  const mockExeca = vi.fn();
  return { execa: mockExeca };
});

import { execa } from "execa";
import { CopilotAgent } from "../../src/agent/copilot-agent.js";
import type { AgentPermissions } from "../../src/agent/permissions.js";

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

  test("adds --add-dir for each entry in opts.additionalDirs outside cwd", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);

    const cwd = await mkdtemp(join(tmpdir(), "copilot-agent-"));
    const externalDir = "/srv/shared";
    const agent = new CopilotAgent({ model: "claude-sonnet-4.5" });
    await agent.run("Document the architecture", {
      cwd,
      additionalDirs: [externalDir],
    });

    expect(mockExeca).toHaveBeenCalledOnce();
    const [, args] = mockExeca.mock.calls[0] as any[];
    expect(args).toEqual([
      "-p",
      "Document the architecture",
      "--allow-all-tools",
      "--no-ask-user",
      "--model",
      "claude-sonnet-4.5",
      "--no-auto-update",
      "--add-dir",
      externalDir,
    ]);
  });

  test("adds one --add-dir pair per entry when multiple additionalDirs are given", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);

    const cwd = await mkdtemp(join(tmpdir(), "copilot-agent-"));
    const agent = new CopilotAgent({ model: "m" });
    await agent.run("p", { cwd, additionalDirs: ["/run/a", "/run/b"] });

    const [, args] = mockExeca.mock.calls[0] as any[];
    expect(args.slice(-4)).toEqual([
      "--add-dir",
      "/run/a",
      "--add-dir",
      "/run/b",
    ]);
  });

  test("omits --add-dir when additionalDirs is not provided", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);

    const cwd = await mkdtemp(join(tmpdir(), "copilot-agent-"));
    const agent = new CopilotAgent({ model: "m" });
    await agent.run("p", { cwd });

    const [, args] = mockExeca.mock.calls[0] as any[];
    expect(args).not.toContain("--add-dir");
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

  test("restores .gitignore and returns exitCode 1 on spawn failure", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "copilot-agent-"));
    const giPath = join(cwd, ".gitignore");
    const originalGitignore = "build/\n";
    await writeFile(giPath, originalGitignore, "utf8");

    mockExeca.mockImplementation(() => {
      throw new Error("spawn failed");
    });

    const agent = new CopilotAgent({ model: "m" });
    const result = await agent.run("p", { cwd });
    expect(result.exitCode).toBe(1);

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
  test("restricts the tool set to file tools, withholding bash", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);

    const cwd = await mkdtemp(join(tmpdir(), "copilot-agent-"));
    const runDir = join(cwd, ".saaga-runs", "test-run");
    const permissions: AgentPermissions = {
      readRoots: [cwd],
      writeRoots: [resolve(cwd, "saaga-docs"), runDir],
      denyPaths: [resolve(cwd, "AGENTS.md")],
      shell: "read-only-git",
    };

    const agent = new CopilotAgent({ model: "m" });
    await agent.run("p", { cwd, permissions, additionalDirs: [runDir] });

    const [, args] = mockExeca.mock.calls[0] as any[];
    const start = args.indexOf("--available-tools");
    expect(start).toBeGreaterThan(-1);
    const tools = args.slice(start + 1, args.indexOf("--allow-all-tools"));
    expect(tools).toEqual(["view", "create", "edit", "glob", "grep"]);
    expect(tools).not.toContain("bash");
  });

  test("keeps the workspace path boundary intact", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);

    const cwd = await mkdtemp(join(tmpdir(), "copilot-agent-"));
    const runDir = join(cwd, ".saaga-runs", "test-run");
    const permissions: AgentPermissions = {
      readRoots: [cwd],
      writeRoots: [resolve(cwd, "saaga-docs"), runDir],
      denyPaths: [],
      shell: "read-only-git",
    };

    const agent = new CopilotAgent({ model: "m" });
    await agent.run("p", { cwd, permissions, additionalDirs: [runDir] });

    const [, args] = mockExeca.mock.calls[0] as any[];
    expect(args).not.toContain("--allow-all-paths");
    expect(args).toContain("--disallow-temp-dir");
  });

  test("uses no deny rules, which are inert alongside --allow-all-tools", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);

    const cwd = await mkdtemp(join(tmpdir(), "copilot-agent-"));
    const permissions: AgentPermissions = {
      readRoots: [cwd],
      writeRoots: [resolve(cwd, "docs")],
      denyPaths: [resolve(cwd, "AGENTS.md")],
      shell: "read-only-git",
    };

    const agent = new CopilotAgent({ model: "m" });
    await agent.run("p", { cwd, permissions });

    const [, args] = mockExeca.mock.calls[0] as any[];
    expect(args).not.toContain("--deny-tool");
    expect(args).not.toContain("--allow-tool");
  });

  test("grants --add-dir for roots outside the cwd only", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);

    const cwd = await mkdtemp(join(tmpdir(), "copilot-agent-"));
    const docsPath = resolve(cwd, "saaga-docs");
    const runDir = join(cwd, ".saaga-runs", "test-run");
    const allowDir = "/srv/shared";
    const permissions: AgentPermissions = {
      readRoots: [cwd, allowDir],
      writeRoots: [docsPath, runDir, allowDir],
      denyPaths: [],
      shell: "read-only-git",
    };

    const agent = new CopilotAgent({ model: "m" });
    await agent.run("p", { cwd, permissions, additionalDirs: [runDir] });

    const [, args] = mockExeca.mock.calls[0] as any[];
    const addDirs: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--add-dir") addDirs.push(args[i + 1]);
    }
    expect(addDirs).toEqual(expect.arrayContaining([allowDir]));
    expect(addDirs).not.toContain(cwd);
    expect(addDirs).not.toContain(docsPath);
    // runDir is inside cwd, so copilot grants it via additionalDirs passthrough
    // but not from permission roots (which are filtered by isInside)
  });

  test("unrestricted path is byte-identical to legacy argv", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);

    const cwd = await mkdtemp(join(tmpdir(), "copilot-agent-"));
    const agent = new CopilotAgent({ model: "claude-sonnet-4.5" });
    await agent.run("Document the architecture", { cwd });

    const [bin, args] = mockExeca.mock.calls[0] as any[];
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
  });

  test("preserves --add-dir in restricted mode for external dirs", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);

    const cwd = await mkdtemp(join(tmpdir(), "copilot-agent-"));
    const externalDir = "/srv/shared";
    const runDir = join(cwd, ".saaga-runs", "test-run");
    const permissions: AgentPermissions = {
      readRoots: [cwd, externalDir],
      writeRoots: [resolve(cwd, "docs"), runDir, externalDir],
      denyPaths: [],
      shell: "read-only-git",
    };

    const agent = new CopilotAgent({ model: "m" });
    await agent.run("p", { cwd, permissions, additionalDirs: [runDir] });

    const [, args] = mockExeca.mock.calls[0] as any[];
    const addDirs: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--add-dir") addDirs.push(args[i + 1]);
    }
    expect(addDirs).toContain(externalDir);
  });
});

describe("backend selector picks CopilotAgent for backend=copilot", () => {
  test("createAgent returns a CopilotAgent instance for backend: 'copilot'", async () => {
    const { createAgent } = await import("../../src/cli/backend.js");
    const agent = createAgent({ backend: "copilot", model: "m" });
    expect(agent.name).toBe("copilot");
  });
});
