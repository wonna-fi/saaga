import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("execa", () => {
  const mockExeca = vi.fn();
  return { execa: mockExeca };
});

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
});

import { execa } from "execa";
import { mkdir, writeFile } from "node:fs/promises";
import { CursorAgent } from "../../src/agent/cursor-agent.js";
import type { AgentPermissions } from "../../src/agent/permissions.js";

const mockExeca = vi.mocked(execa);
const _mockMkdir = vi.mocked(mkdir);
const mockWriteFile = vi.mocked(writeFile);

describe("CursorAgent", () => {
  beforeEach(() => {
    mockExeca.mockReset();
    _mockMkdir.mockReset();
    mockWriteFile.mockReset();
    _mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });
  test("spawns cursor-agent with correct flags and propagates exit code (unrestricted)", async () => {
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
    expect(opts.stdin).toBe("ignore");
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
    expect(opts.stdin).toBe("ignore");
  });

  test("uses stdio inherit when no logFile and stdin is ignored", async () => {
    mockExeca.mockReturnValue(
      Promise.resolve({ exitCode: 0 }) as any,
    );

    const agent = new CursorAgent({ model: "m" });
    await agent.run("p", { cwd: "/app" });

    const [, , opts] = mockExeca.mock.calls[0] as any[];
    expect(opts.stdin).toBe("ignore");
    expect(opts.stdout).toBe("inherit");
    expect(opts.stderr).toBe("inherit");
  });

  test("uses --trust instead of --force when permissions present", async () => {
    mockExeca.mockReturnValue(
      Promise.resolve({ exitCode: 0 }) as any,
    );

    const runDir = "/app/.saaga-runs/test-run";
    const permissions: AgentPermissions = {
      readRoots: ["/app"],
      writeRoots: ["/app/saaga-docs", runDir],
      denyPaths: ["/app/AGENTS.md"],
      shell: "restricted",
    };

    const agent = new CursorAgent({ model: "m" });
    await agent.run("p", {
      cwd: "/app",
      permissions,
      additionalDirs: [runDir],
    });

    const [, args] = mockExeca.mock.calls[0] as any[];
    expect(args).toContain("--trust");
    expect(args).not.toContain("--force");
  });

  test("sets CURSOR_CONFIG_DIR in env when permissions present", async () => {
    mockExeca.mockReturnValue(
      Promise.resolve({ exitCode: 0 }) as any,
    );

    const runDir = "/app/.saaga-runs/test-run";
    const permissions: AgentPermissions = {
      readRoots: ["/app"],
      writeRoots: ["/app/saaga-docs", runDir],
      denyPaths: ["/app/AGENTS.md"],
      shell: "restricted",
    };

    const agent = new CursorAgent({ model: "m" });
    await agent.run("p", {
      cwd: "/app",
      permissions,
      additionalDirs: [runDir],
    });

    const [, , opts] = mockExeca.mock.calls[0] as any[];
    expect(opts.env).toBeDefined();
    expect(opts.env.CURSOR_CONFIG_DIR).toBe(
      resolve(runDir, ".cursor-cli"),
    );
  });

  test("writes cli-config.json that carves out the permitted paths", async () => {
    mockExeca.mockReturnValue(
      Promise.resolve({ exitCode: 0 }) as any,
    );

    // Enumeration reads the filesystem, so this needs a real tree.
    const base = mkdtempSync(join(tmpdir(), "cursor-cfg-"));
    const appDir = join(base, "app");
    const runDir = join(appDir, ".saaga-runs", "test-run");
    const docsPath = join(appDir, "saaga-docs");
    mkdirSync(join(appDir, "src"), { recursive: true });
    mkdirSync(docsPath, { recursive: true });
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(appDir, "AGENTS.md"), "rules\n");

    const permissions: AgentPermissions = {
      readRoots: [appDir],
      writeRoots: [docsPath, runDir],
      denyPaths: [join(appDir, "AGENTS.md"), join(appDir, ".cursor/rules/**")],
      shell: "restricted",
    };

    const agent = new CursorAgent({ model: "m" });
    await agent.run("p", { cwd: appDir, permissions, additionalDirs: [runDir] });

    expect(mockWriteFile).toHaveBeenCalledOnce();
    const [path, content] = mockWriteFile.mock.calls[0] as [string, string];
    expect(path).toBe(resolve(runDir, ".cursor-cli", "cli-config.json"));

    const { deny, allow } = JSON.parse(content).permissions as {
      deny: string[];
      allow: string[];
    };

    // Readable but unwritable paths inside the app get write denies only.
    expect(deny).toEqual(
      expect.arrayContaining([
        `Write(${join(appDir, "src")})`,
        `Write(${join(appDir, "src")}/**)`,
        `Edit(${join(appDir, "src")})`,
        `Write(${join(appDir, "AGENTS.md")})`,
      ]),
    );
    expect(deny).not.toContain(`Read(${join(appDir, "src")})`);

    // A rule path that is already a glob is not re-suffixed.
    expect(deny).toContain(`Write(${join(appDir, ".cursor/rules/**")})`);
    expect(deny).not.toContain(`Write(${join(appDir, ".cursor/rules/**")}/**)`);

    // Nothing may deny the write roots, since deny beats allow.
    for (const rule of deny) {
      expect(rule).not.toContain(docsPath);
      expect(rule).not.toContain(runDir);
    }

    // A blanket deny would swallow the write roots along with everything else.
    expect(deny).not.toContain("Write(*)");
    expect(deny).not.toContain("Edit(*)");

    // Shell is the one default-deny surface, so allow is the right lever.
    expect(allow).toEqual(
      expect.arrayContaining([
        "Shell(cd:*)",
        "Shell(ls:*)",
        "Shell(pwd:*)",
        "Shell(git:log*)",
        "Shell(git:show*)",
        "Shell(git:diff*)",
      ]),
    );

    rmSync(base, { recursive: true, force: true });
  });

  test("unrestricted path is byte-identical to legacy argv", async () => {
    mockExeca.mockReturnValue(
      Promise.resolve({ exitCode: 0 }) as any,
    );

    const agent = new CursorAgent({ model: "claude-4.6-opus-high-thinking" });
    await agent.run("Document the architecture", { cwd: "/tmp/myapp" });

    const [bin, args] = mockExeca.mock.calls[0] as any[];
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
  });
});

describe("CursorAgent per-call model override", () => {
  beforeEach(() => {
    mockExeca.mockReset();
  });

  test("opts.model replaces the model bound at construction", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);
    const cwd = mkdtempSync(join(tmpdir(), "cursor-agent-model-"));
    const agent = new CursorAgent({ model: "composer-2.5" });

    await agent.run("p", { cwd, model: "per-step-model" });

    const [, args] = mockExeca.mock.calls[0] as any[];
    expect(args).toContain("per-step-model");
    expect(args).not.toContain("composer-2.5");
  });

  test("the constructor model is used when opts.model is absent", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);
    const cwd = mkdtempSync(join(tmpdir(), "cursor-agent-model-"));
    const agent = new CursorAgent({ model: "composer-2.5" });

    await agent.run("p", { cwd });

    const [, args] = mockExeca.mock.calls[0] as any[];
    expect(args).toContain("composer-2.5");
  });
});
