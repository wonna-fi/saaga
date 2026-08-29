import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("execa", () => {
  const mockExeca = vi.fn();
  return { execa: mockExeca };
});

import { execa } from "execa";
import {
  CLAUDE_RESTRICTED_TOOLS,
  ClaudeAgent,
} from "../../src/agent/claude-agent.js";
import {
  ALLOWED_SHELL_COMMANDS,
  type AgentPermissions,
} from "../../src/agent/permissions.js";

const mockExeca = vi.mocked(execa);

/** Every Edit rule that scopes a path, leaving out Bash command rules. */
function pathRules(settings: any): string[] {
  return [...settings.permissions.allow, ...settings.permissions.deny].filter(
    (rule: string) => rule.startsWith("Edit("),
  );
}

describe("ClaudeAgent", () => {
  beforeEach(() => {
    mockExeca.mockReset();
  });
  afterEach(() => {
    mockExeca.mockReset();
  });

  test("spawns claude with correct flags and propagates exit code (unrestricted)", async () => {
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
    expect(opts.stdin).toBe("ignore");
    expect(opts.stdout).toBe("inherit");
    expect(opts.stderr).toBe("inherit");

    expect(result.exitCode).toBe(0);
  });

  test("uses --permission-mode dontAsk and --settings JSON when permissions present", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);

    const cwd = await mkdtemp(join(tmpdir(), "claude-agent-"));
    const runDir = join(cwd, ".saaga-runs", "test-run");
    const permissions: AgentPermissions = {
      readRoots: [cwd],
      writeRoots: [resolve(cwd, "saaga-docs"), runDir],
      denyPaths: [resolve(cwd, "AGENTS.md")],
      shell: "restricted",
    };

    const agent = new ClaudeAgent({ model: "opus" });
    await agent.run("p", {
      cwd,
      permissions,
      additionalDirs: [runDir],
    });

    const [bin, args] = mockExeca.mock.calls[0] as any[];
    expect(bin).toBe("claude");
    expect(args).toContain("--permission-mode");
    expect(args).toContain("dontAsk");
    expect(args).not.toContain("--dangerously-skip-permissions");

    const settingsIdx = args.indexOf("--settings");
    expect(settingsIdx).toBeGreaterThan(-1);
    const settings = JSON.parse(args[settingsIdx + 1]);
    expect(settings.permissions.allow).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Edit(//"),
      ]),
    );
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Edit(//"),
      ]),
    );
    // runDir is inside cwd, so additionalDirectories should be empty
    expect(settings.permissions.additionalDirectories).toEqual([]);
  });

  test("derives additionalDirectories from the profile, not from opts.additionalDirs", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);

    const cwd = await mkdtemp(join(tmpdir(), "claude-agent-"));
    const runDir = join(cwd, ".saaga-runs", "test-run");
    const extraDir = "/srv/shared-lib";
    const permissions: AgentPermissions = {
      readRoots: [cwd, extraDir],
      writeRoots: [resolve(cwd, "saaga-docs"), runDir, extraDir],
      denyPaths: [],
      shell: "restricted",
    };

    const agent = new ClaudeAgent({ model: "opus" });
    await agent.run("p", { cwd, permissions, additionalDirs: [runDir] });

    const [, args] = mockExeca.mock.calls[0] as any[];
    const settings = JSON.parse(args[args.indexOf("--settings") + 1]);
    const dirs = settings.permissions.additionalDirectories as string[];

    // Only non-cwd roots need to be reachable via additionalDirectories
    expect(dirs).toContain(extraDir);
    // runDir is inside cwd, so it doesn't need to be listed
    expect(dirs).not.toContain(runDir);
    // A child of cwd doesn't need to be listed separately
    expect(dirs).not.toContain(resolve(cwd, "saaga-docs"));
  });

  test("claude settings use Edit not Write for rules", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);

    const cwd = await mkdtemp(join(tmpdir(), "claude-agent-"));
    const permissions: AgentPermissions = {
      readRoots: [cwd],
      writeRoots: [resolve(cwd, "docs")],
      denyPaths: [resolve(cwd, "AGENTS.md")],
      shell: "restricted",
    };

    const agent = new ClaudeAgent({ model: "opus" });
    await agent.run("p", { cwd, permissions });

    const [, args] = mockExeca.mock.calls[0] as any[];
    const settingsIdx = args.indexOf("--settings");
    const settings = JSON.parse(args[settingsIdx + 1]);

    for (const rule of pathRules(settings)) {
      expect(rule).toMatch(/^Edit\(/);
      expect(rule).not.toMatch(/^Write\(/);
    }
  });

  test("allows only the restricted shell commands", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);

    const cwd = await mkdtemp(join(tmpdir(), "claude-agent-"));
    const permissions: AgentPermissions = {
      readRoots: [cwd],
      writeRoots: [resolve(cwd, "docs")],
      denyPaths: [],
      shell: "restricted",
    };

    const agent = new ClaudeAgent({ model: "opus" });
    await agent.run("p", { cwd, permissions });

    const [, args] = mockExeca.mock.calls[0] as any[];
    const settings = JSON.parse(args[args.indexOf("--settings") + 1]);
    const bashAllows = settings.permissions.allow.filter((rule: string) =>
      rule.startsWith("Bash("),
    );
    const bashDenies = settings.permissions.deny.filter((rule: string) =>
      rule.startsWith("Bash("),
    );

    expect(settings.permissions.deny).not.toContain("Bash");
    expect(bashAllows).toEqual([
      ...ALLOWED_SHELL_COMMANDS.utilities.map((command) => `Bash(${command}:*)`),
      ...ALLOWED_SHELL_COMMANDS.git.map(
        (subcommand) => `Bash(git ${subcommand}:*)`,
      ),
    ]);
    // Claude's built-in read-only Bash set bypasses allowlists under dontAsk,
    // so extras outside the restricted policy must be denied by name.
    expect(bashDenies).toEqual(
      expect.arrayContaining([
        "Bash(cat *)",
        "Bash(echo *)",
        "Bash(sha256sum *)",
        "Bash(python3 *)",
      ]),
    );
  });

  test("denies Bash outright when the profile disallows shell access", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);

    const cwd = await mkdtemp(join(tmpdir(), "claude-agent-"));
    const permissions: AgentPermissions = {
      readRoots: [cwd],
      writeRoots: [resolve(cwd, "docs")],
      denyPaths: [],
      shell: "none",
    };

    const agent = new ClaudeAgent({ model: "opus" });
    await agent.run("p", { cwd, permissions });

    const [, args] = mockExeca.mock.calls[0] as any[];
    const settings = JSON.parse(args[args.indexOf("--settings") + 1]);

    expect(settings.permissions.deny).toContain("Bash");
    for (const rule of settings.permissions.allow) {
      expect(rule).not.toMatch(/^Bash/);
    }
    for (const rule of settings.permissions.deny) {
      expect(rule).not.toMatch(/^Bash\(/);
    }
  });

  // Claude has no exclusive allowlist, so the deny list is open-ended: a tool
  // introduced in a later CLI release arrives enabled until it is named here.
  // Pinning the exact set means an omission fails in unit tests rather than
  // only in the live `claude/tool-surface` probe, which needs a model call.
  test("denies every tool outside the restricted profile by name", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);

    const cwd = await mkdtemp(join(tmpdir(), "claude-agent-"));
    const permissions: AgentPermissions = {
      readRoots: [cwd],
      writeRoots: [resolve(cwd, "docs")],
      denyPaths: [],
      shell: "restricted",
    };

    const agent = new ClaudeAgent({ model: "opus" });
    await agent.run("p", { cwd, permissions });

    const [, args] = mockExeca.mock.calls[0] as any[];
    const settings = JSON.parse(args[args.indexOf("--settings") + 1]);
    // Bare tool names, leaving out the scoped Bash(...) and Edit(...) rules.
    const toolDenies = settings.permissions.deny.filter(
      (rule: string) => !rule.includes("("),
    );

    expect(toolDenies).toEqual([
      "CronCreate",
      "CronDelete",
      "CronList",
      "DesignSync",
      "EnterWorktree",
      "ExitWorktree",
      // Enumerates other agent sessions to message.
      "ListAgents",
      "Monitor",
      "NotebookEdit",
      "PushNotification",
      // Schedules work that would run outside the sandbox.
      "RemoteTrigger",
      "ReportFindings",
      "ScheduleWakeup",
      "SendMessage",
      "Skill",
      "Task",
      "TaskCreate",
      "TaskGet",
      "TaskList",
      "TaskOutput",
      "TaskStop",
      "TaskUpdate",
      "ToolSearch",
      "WebFetch",
      "WebSearch",
      "Workflow",
    ]);

    // A denied name must never be one the profile depends on.
    for (const tool of CLAUDE_RESTRICTED_TOOLS) {
      expect(toolDenies).not.toContain(tool);
    }
  });

  test("claude settings use double-slash for absolute paths", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);

    const cwd = await mkdtemp(join(tmpdir(), "claude-agent-"));
    const permissions: AgentPermissions = {
      readRoots: [cwd],
      writeRoots: ["/absolute/path/docs"],
      denyPaths: ["/absolute/path/AGENTS.md"],
      shell: "restricted",
    };

    const agent = new ClaudeAgent({ model: "opus" });
    await agent.run("p", { cwd, permissions });

    const [, args] = mockExeca.mock.calls[0] as any[];
    const settingsIdx = args.indexOf("--settings");
    const settings = JSON.parse(args[settingsIdx + 1]);

    for (const rule of pathRules(settings)) {
      expect(rule).toMatch(/Edit\(\/\//);
    }
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
    expect(opts.cancelSignal).toBe(controller.signal);
  });
});

describe("backend selector picks ClaudeAgent for backend=claude", () => {
  test("createAgent returns a ClaudeAgent instance for backend: 'claude'", async () => {
    const { createAgent } = await import("../../src/cli/backend.js");
    const agent = createAgent({ backend: "claude", model: "opus" });
    expect(agent.name).toBe("claude");
  });
});
