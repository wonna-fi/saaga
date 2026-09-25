import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { CodexAgent, buildCodexArgs } from "../../src/agent/codex-agent.js";
import { buildProfile } from "../../src/agent/permissions.js";

vi.mock("execa", () => ({ execa: vi.fn() }));
const mockExeca = vi.mocked(execa);
let cwd: string;
let runDir: string;
let permissions: ReturnType<typeof buildProfile>;

function configs(args: readonly string[]) {
  return args.filter((_arg, i) => args[i - 1] === "--config");
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "saaga.codex with spaces-"));
  runDir = `${cwd}/.saaga-runs/test`;
  permissions = buildProfile({ appPath: cwd, docsDir: "docs", runDir });
  mockExeca.mockReset();
  mockExeca.mockReturnValue(Promise.resolve({ exitCode: 0 }) as any);
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("CodexAgent", () => {
  test("creates missing writable roots before launching the sandbox, excluding protected paths", async () => {
    const extra = `${cwd}/extra/nested`;
    const protectedChild = `${cwd}/.codex/nested`;
    const profile = buildProfile({ appPath: cwd, docsDir: "docs", runDir, allowDirs: [extra, protectedChild] });
    expect(existsSync(`${cwd}/docs`)).toBe(false);
    mockExeca.mockImplementationOnce(() => {
      for (const path of [`${cwd}/docs`, runDir, extra]) expect(existsSync(path)).toBe(true);
      expect(existsSync(protectedChild)).toBe(false);
      expect(existsSync(`${cwd}/docs/BASELINE`)).toBe(false);
      return Promise.resolve({ exitCode: 0 }) as any;
    });
    expect(await new CodexAgent({ model: "m" }).run("p", { cwd, permissions: profile })).toEqual({ exitCode: 0 });
    expect(mockExeca).toHaveBeenCalledOnce();
  });

  test("runs non-interactively, streams logs, and propagates failure", async () => {
    mockExeca.mockReturnValue(Promise.resolve({ exitCode: 7 }) as any);
    const signal = new AbortController().signal;
    const result = await new CodexAgent({ model: "gpt-6-sol" }).run("--prompt-looking text", {
      cwd, signal, permissions, logFile: "/tmp/agent.log", echo: true,
    });
    expect(result.exitCode).toBe(7);
    const [binary, args, options] = mockExeca.mock.calls[0] as any[];
    expect(binary).toBe("codex");
    expect(args.slice(0, 3)).toEqual(["exec", "--model", "gpt-6-sol"]);
    expect(args.slice(-2)).toEqual(["--", "--prompt-looking text"]);
    expect(options).toMatchObject({ cwd, reject: false, stdin: "ignore", cancelSignal: signal,
      stdout: ["inherit", { file: "/tmp/agent.log", append: true }],
      stderr: ["inherit", { file: "/tmp/agent.log", append: true }],
    });
  });

  test("per-step model overrides do not change the constructor default", async () => {
    const agent = new CodexAgent({ model: "gpt-6-luna" });
    await agent.run("p", { cwd, model: "gpt-6-sol" });
    await agent.run("p", { cwd });
    expect(mockExeca.mock.calls[0][1]).toContain("gpt-6-sol");
    expect(mockExeca.mock.calls[1][1]).toContain("gpt-6-luna");
  });

  test("handles spawn failure and signal termination", async () => {
    mockExeca.mockImplementationOnce(() => { throw new Error("ENOENT"); });
    expect(await new CodexAgent({ model: "m" }).run("p", { cwd })).toEqual({ exitCode: 1 });
    mockExeca.mockReturnValueOnce(Promise.resolve({ exitCode: undefined }) as any);
    expect(await new CodexAgent({ model: "m" }).run("p", { cwd })).toEqual({ exitCode: 1 });
  });

  test("drains JSON output while the process is running", async () => {
    const stdout = Readable.from([JSON.stringify({ type: "turn.completed", usage: { input_tokens: 5, output_tokens: 3 } }) + "\n"]);
    // Completion depends on draining stdout, reproducing a full pipe buffer.
    const proc = Object.assign(new Promise(resolve => stdout.on("end", () => resolve({ exitCode: 0 }))), { stdout });
    mockExeca.mockReturnValueOnce(proc as any);
    const onEvent = vi.fn();
    expect(await new CodexAgent({ model: "m" }).run("p", { cwd, permissions, onEvent })).toEqual({ exitCode: 0 });
    expect(mockExeca.mock.calls[0][1]).toContain("--json");
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "usage", inputTokens: 5, outputTokens: 3 }));
  });
});

describe("Codex configuration", () => {
  test("limits writes to docs and run directories and protects managed files", () => {
    const args = buildCodexArgs("m", "p", { cwd, permissions });
    expect(args).not.toContain("--sandbox");
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    const config = configs(args);
    expect(config).toContain('default_permissions="saaga"');
    expect(config).toContain('approval_policy="never"');
    expect(config).toContain('web_search="disabled"');
    const profile = config.find(c => c.startsWith("permissions="))!;
    expect(profile).toContain(`"${cwd}" = "read"`);
    expect(profile).toContain(`"${cwd}/docs" = "write"`);
    expect(profile).toContain(`"${runDir}" = "write"`);
    expect(profile).toContain(`"${cwd}/docs/BASELINE" = "read"`);
    expect(profile).toContain(`"${cwd}/AGENTS.md" = "read"`);
    expect(profile).toContain(`"${cwd}/.git" = "read"`);
    expect(profile).toContain('"enabled" = false');
    expect(profile).not.toContain('":root"');
    expect(profile).not.toContain('":tmpdir"');
  });

  test("ignores user permissions, exec rules, MCP/plugin config and project hooks", () => {
    const args = buildCodexArgs("m", "p", { cwd, permissions });
    expect(args).toEqual(expect.arrayContaining(["--ignore-user-config", "--ignore-rules", "--strict-config"]));
    const config = configs(args);
    expect(config).toContain(`projects={"${cwd}" = {"trust_level" = "untrusted"}}`);
    expect(config.find(c => c.startsWith("features="))).toContain('"plugins" = false');
    expect(config.find(c => c.startsWith("features="))).toContain('"apps" = false');
    expect(config.find(c => c.startsWith("features="))).toContain('"multi_agent" = false');
    expect(config.find(c => c.startsWith("hooks="))).toContain("PreToolUse");
  });

  test("honors profile roots without granting additionalDirs", () => {
    const profile = buildProfile({ appPath: cwd, docsDir: "docs", runDir, allowDirs: ["/outside/granted"] });
    const args = buildCodexArgs("m", "p", { cwd, permissions: profile, additionalDirs: ["/outside/not-granted"] });
    const config = configs(args).find(c => c.startsWith("permissions="))!;
    expect(config).toContain('"/outside/granted" = "write"');
    expect(config).not.toContain("/outside/not-granted");
  });

  test("allow-dir cannot reopen a child of a protected path", () => {
    const profile = buildProfile({ appPath: cwd, docsDir: "docs", runDir, allowDirs: [`${cwd}/.git/objects`, `${cwd}/.cursor/rules/nested`] });
    const config = configs(buildCodexArgs("m", "p", { cwd, permissions: profile })).find(c => c.startsWith("permissions="))!;
    expect(config).not.toContain(`"${cwd}/.git/objects" = "write"`);
    expect(config).not.toContain(`"${cwd}/.cursor/rules/nested" = "write"`);
  });

  test("shell none disables the shell tool and keeps the guard", () => {
    const config = configs(buildCodexArgs("m", "p", { cwd, permissions: { ...permissions, shell: "none" } }));
    expect(config.find(c => c.startsWith("features="))).toContain('"shell_tool" = false');
    expect(config.find(c => c.startsWith("hooks="))).toContain("PreToolUse");
  });

  test.each([true, false])("sets service tier for fast=%s on either permission path", (fast) => {
    for (const profile of [permissions, undefined]) {
      const args = buildCodexArgs("m", "p", { cwd, permissions: profile }, fast);
      expect(configs(args)).toContain(`service_tier="${fast ? "fast" : "default"}"`);
    }
  });

  test("unrestricted runs retain structured output and skip profile/hook setup", () => {
    const args = buildCodexArgs("m", "p", { cwd, onEvent: vi.fn() });
    expect(args).toEqual(expect.arrayContaining(["--dangerously-bypass-approvals-and-sandbox", "--json"]));
    expect(args).not.toContain("--ignore-user-config");
    expect(configs(args).some(c => c.startsWith("permissions="))).toBe(false);
    expect(configs(args).some(c => c.startsWith("hooks="))).toBe(false);
  });
});
