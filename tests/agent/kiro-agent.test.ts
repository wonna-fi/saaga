import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// The mock has a plain signature instead of execa's. Casting to execa's real
// overloads crashes typescript-eslint with a stack overflow.
const { mockExeca } = vi.hoisted(() => ({
  mockExeca: vi.fn<(bin: string, args: string[], opts: Record<string, unknown>) => unknown>(),
}));
vi.mock("execa", () => ({ execa: mockExeca }));

// Writes pass through to the real fs, except paths a test marks as failing.
const { failWrites } = vi.hoisted(() => ({ failWrites: { matching: undefined as RegExp | undefined } }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const writeFile: typeof actual.writeFile = async (file, ...rest) => {
    if (failWrites.matching?.test(String(file))) {
      throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    }
    return actual.writeFile(file, ...rest);
  };
  return { ...actual, writeFile };
});

import {
  KIRO_PROFILE_MARKER,
  KiroAgent,
  buildKiroArgs,
  buildKiroPermissionRules,
  realPathForms,
  sweepStaleProfiles,
  watchForLoginFlow,
} from "../../src/agent/kiro-agent.js";
import type { AgentPermissions } from "../../src/agent/permissions.js";


/** A resolved execa result that also carries the process fields the agent reads. */
function fakeProc(
  result: { exitCode?: number },
  extra: { pid?: number; stdout?: AsyncIterable<string | Uint8Array> } = {},
): any {
  return Object.assign(Promise.resolve(result), extra);
}

const PERMS: AgentPermissions = {
  readRoots: ["/app"],
  writeRoots: ["/app/docs", "/app/.saaga-runs/run-1"],
  denyPaths: ["/app/AGENTS.md", "/app/.cursor/rules/**"],
  shell: "restricted",
};

let scratch: string;
let homeDir: string;
let runDir: string;

beforeEach(() => {
  mockExeca.mockReset();
  scratch = mkdtempSync(join(tmpdir(), "kiro-agent-"));
  homeDir = join(scratch, "home");
  runDir = join(scratch, "run");
  mkdirSync(homeDir);
  mkdirSync(runDir);
});

afterEach(() => {
  failWrites.matching = undefined;
  rmSync(scratch, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Kiro's real spinner output, split so the marker spans two chunks. */
const SPINNER = ["\x1b[?25l\r▰▱▱▱▱▱▱ Opening brow", "ser... | Press (^) + C to cancel\r▰▰▱▱▱▱▱ Opening browser..."];

describe("createAgent", () => {
  test("returns a KiroAgent for backend: 'kiro'", async () => {
    const { createAgent } = await import("../../src/cli/backend.js");
    expect(createAgent({ backend: "kiro", model: "m" }).name).toBe("kiro");
  });
});

describe("buildKiroArgs", () => {
  test("restricted: selects the profile agent and never trusts all tools", () => {
    const args = buildKiroArgs("claude-haiku-4.5", "do it", {
      agentName: "saaga-abc",
      streamJson: true,
    });
    expect(args).toEqual([
      "chat",
      "--no-interactive",
      "--v3",
      "--model",
      "claude-haiku-4.5",
      "--output-format",
      "stream-json",
      "--agent",
      "saaga-abc",
      "do it",
    ]);
  });

  test("unrestricted: trusts all tools and names no agent", () => {
    const args = buildKiroArgs("m", "p", { streamJson: false });
    expect(args).toContain("--trust-all-tools");
    expect(args).not.toContain("--agent");
    expect(args).toContain("text");
  });

  test("always pins the v3 engine and an explicit model", () => {
    for (const opts of [{ streamJson: true }, { agentName: "saaga-x", streamJson: false }]) {
      const args = buildKiroArgs("claude-sonnet-4.5", "p", opts);
      expect(args).toContain("--v3");
      expect(args[args.indexOf("--model") + 1]).toBe("claude-sonnet-4.5");
      expect(args.at(-1)).toBe("p");
    }
  });
});

describe("KiroAgent.run", () => {
  test("unrestricted run spawns kiro-cli detached and writes no profile", async () => {
    mockExeca.mockReturnValue(fakeProc({ exitCode: 0 }));
    const agent = new KiroAgent({ model: "claude-haiku-4.5", homeDir });

    const result = await agent.run("hello", { cwd: "/app" });

    expect(result.exitCode).toBe(0);
    const [bin, args, opts] = mockExeca.mock.calls[0];
    expect(bin).toBe("kiro-cli");
    expect(args).toContain("--trust-all-tools");
    expect(opts).toMatchObject({ cwd: "/app", reject: false, detached: true });
    // Without PWD, kiro's shell reports the physical path of a symlinked cwd.
    expect(opts.env).toEqual({ PWD: "/app" });
    expect(opts.cancelSignal).toBeUndefined();
    expect(existsSync(join(homeDir, ".kiro"))).toBe(false);
  });

  test("per-call model overrides the constructor model", async () => {
    mockExeca.mockReturnValue(fakeProc({ exitCode: 0 }));
    const agent = new KiroAgent({ model: "claude-haiku-4.5", homeDir });
    await agent.run("p", { cwd: "/app", model: "claude-sonnet-4.5" });
    const args = mockExeca.mock.calls[0][1];
    expect(args[args.indexOf("--model") + 1]).toBe("claude-sonnet-4.5");
  });

  test("propagates a non-zero exit code", async () => {
    mockExeca.mockReturnValue(fakeProc({ exitCode: 3 }));
    const agent = new KiroAgent({ model: "m", homeDir });
    expect((await agent.run("p", { cwd: "/app" })).exitCode).toBe(3);
  });

  test("restricted run installs a marked temporary agent and removes it afterwards", async () => {
    const agentsDir = join(homeDir, ".kiro", "agents");
    let seenAtSpawn: { name: string; content: any } | undefined;
    mockExeca.mockImplementation((_bin, args) => {
      const name = args[args.indexOf("--agent") + 1];
      seenAtSpawn = {
        name,
        content: JSON.parse(readFileSync(join(agentsDir, `${name}.json`), "utf8")),
      };
      return fakeProc({ exitCode: 0 });
    });

    const agent = new KiroAgent({ model: "m", homeDir });
    await agent.run("p", { cwd: "/app", permissions: PERMS, additionalDirs: [runDir] });

    expect(seenAtSpawn!.name).toMatch(/^saaga-[0-9a-f]{12}$/);
    expect(seenAtSpawn!.content).toMatchObject({
      name: seenAtSpawn!.name,
      description: KIRO_PROFILE_MARKER,
      tools: ["*"],
    });
    expect(seenAtSpawn!.content.permissions.rules.length).toBeGreaterThan(0);
    const args = mockExeca.mock.calls[0][1];
    expect(args).not.toContain("--trust-all-tools");

    // The agents directory did not exist before, so the agent removes it too.
    expect(existsSync(agentsDir)).toBe(false);
  });

  test("keeps a pre-existing agents directory and the user's agents in it", async () => {
    const agentsDir = join(homeDir, ".kiro", "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "mine.json"), "{}");
    mockExeca.mockReturnValue(fakeProc({ exitCode: 0 }));

    await new KiroAgent({ model: "m", homeDir }).run("p", {
      cwd: "/app",
      permissions: PERMS,
      additionalDirs: [runDir],
    });

    expect(readdirSync(agentsDir)).toEqual(["mine.json"]);
  });

  test("writes a record of the profile into the run directory and keeps it", async () => {
    let agentFile = "";
    mockExeca.mockImplementation((_bin, args) => {
      const name = args[args.indexOf("--agent") + 1];
      agentFile = readFileSync(join(homeDir, ".kiro", "agents", `${name}.json`), "utf8");
      return fakeProc({ exitCode: 0 });
    });

    await new KiroAgent({ model: "m", homeDir }).run("p", {
      cwd: "/app",
      permissions: PERMS,
      additionalDirs: [runDir],
    });

    expect(readFileSync(join(runDir, ".kiro-cli", "agent.json"), "utf8")).toBe(agentFile);
  });

  test("runs without a run directory, skipping the record", async () => {
    mockExeca.mockReturnValue(fakeProc({ exitCode: 0 }));
    const result = await new KiroAgent({ model: "m", homeDir }).run("p", {
      cwd: "/app",
      permissions: PERMS,
    });
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(runDir, ".kiro-cli"))).toBe(false);
  });

  test("a failed agent-file write leaves ~/.kiro as it was found", async () => {
    failWrites.matching = /\.kiro\/agents\/saaga-[0-9a-f]+\.json$/;
    await expect(
      new KiroAgent({ model: "m", homeDir }).run("p", {
        cwd: "/app",
        permissions: PERMS,
        additionalDirs: [runDir],
      }),
    ).rejects.toThrow(/EACCES/);
    expect(existsSync(join(homeDir, ".kiro", "agents"))).toBe(false);
    expect(mockExeca).not.toHaveBeenCalled();
  });

  test("removes the temporary agent when the spawn itself throws", async () => {
    mockExeca.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const result = await new KiroAgent({ model: "m", homeDir }).run("p", {
      cwd: "/app",
      permissions: PERMS,
      additionalDirs: [runDir],
    });
    expect(result.exitCode).toBe(1);
    expect(existsSync(join(homeDir, ".kiro", "agents"))).toBe(false);
  });

  test("cancellation signals kiro's whole process group", async () => {
    let finish!: (r: { exitCode?: number }) => void;
    const proc = Object.assign(new Promise((r) => (finish = r)), { pid: 4242 });
    mockExeca.mockReturnValue(proc);
    const kill = vi.spyOn(process, "kill").mockImplementation((() => {
      finish({ exitCode: undefined });
      return true;
    }) as any);
    const exitListeners = process.listenerCount("exit");

    const controller = new AbortController();
    const running = new KiroAgent({ model: "m", homeDir }).run("p", {
      cwd: "/app",
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    const result = await running;

    expect(kill).toHaveBeenCalledWith(-4242, "SIGTERM");
    expect(result.exitCode).toBe(1);
    expect(process.listenerCount("exit")).toBe(exitListeners);
  });

  test("a run that starts kiro's browser login is stopped with a login hint", async () => {
    let finish!: (r: { exitCode?: number }) => void;
    async function* spinner(): AsyncGenerator<Uint8Array> {
      const enc = new TextEncoder();
      for (const part of SPINNER) yield enc.encode(part);
      // Kiro would wait here indefinitely. The kill below ends it.
      await new Promise((r) => setTimeout(r, 10));
    }
    const proc = Object.assign(new Promise((r) => (finish = r)), {
      pid: 777,
      stdout: spinner(),
    });
    mockExeca.mockReturnValue(proc);
    const kill = vi.spyOn(process, "kill").mockImplementation((() => {
      finish({ exitCode: undefined });
      return true;
    }) as any);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = await new KiroAgent({ model: "m", homeDir }).run("p", {
      cwd: "/app",
      onEvent: () => {},
    });

    expect(kill).toHaveBeenCalledWith(-777, "SIGTERM");
    expect(result.exitCode).toBe(1);
    expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toMatch(/kiro-cli login/);
  });

  test("text mode pipes stdout too, so the login guard covers ordinary runs", async () => {
    let finish!: (r: { exitCode?: number }) => void;
    async function* spinner(): AsyncGenerator<string> {
      yield* SPINNER;
      await new Promise((r) => setTimeout(r, 10));
    }
    const proc = Object.assign(new Promise((r) => (finish = r)), { pid: 778, stdout: spinner() });
    mockExeca.mockReturnValue(proc);
    const kill = vi.spyOn(process, "kill").mockImplementation((() => {
      finish({ exitCode: undefined });
      return true;
    }) as any);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const logFile = join(scratch, "run.log");

    const result = await new KiroAgent({ model: "m", homeDir }).run("p", { cwd: "/app", logFile });

    const opts = mockExeca.mock.calls[0][2];
    expect(mockExeca.mock.calls[0][1]).toContain("text");
    // Output still goes to the log file, and the pipe is added for the guard.
    expect(opts.stdout).toEqual(["pipe", { file: logFile, append: true }]);
    expect(kill).toHaveBeenCalledWith(-778, "SIGTERM");
    expect(result.exitCode).toBe(1);
  });

  test("SIGTERM to Saaga stops kiro's group and exits as the signal would have", async () => {
    let finish!: (r: { exitCode?: number }) => void;
    const proc = Object.assign(new Promise((r) => (finish = r)), { pid: 99 });
    mockExeca.mockReturnValue(proc);
    const kill = vi.spyOn(process, "kill").mockImplementation((() => true) as any);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      finish({ exitCode: undefined });
    }) as never);
    const before = { term: process.listenerCount("SIGTERM"), hup: process.listenerCount("SIGHUP") };

    const running = new KiroAgent({ model: "m", homeDir }).run("p", { cwd: "/app" });
    await Promise.resolve();
    expect(process.listenerCount("SIGHUP")).toBe(before.hup + 1);
    // Call our listener directly. Emitting a real SIGTERM would also reach
    // the test worker's own handlers.
    const ours = process.listeners("SIGTERM").at(-1) as (signal: NodeJS.Signals) => void;
    ours("SIGTERM");
    await running;

    expect(kill).toHaveBeenCalledWith(-99, "SIGTERM");
    expect(exit).toHaveBeenCalledWith(143);
    expect(process.listenerCount("SIGTERM")).toBe(before.term);
    expect(process.listenerCount("SIGHUP")).toBe(before.hup);
  });

  describe("Ctrl+C (SIGINT)", () => {
    // Stand in for the test worker's own SIGINT handlers, so each test
    // controls which listeners exist.
    let saved: NodeJS.SignalsListener[] = [];
    beforeEach(() => {
      saved = process.listeners("SIGINT");
      process.removeAllListeners("SIGINT");
    });
    afterEach(() => {
      process.removeAllListeners("SIGINT");
      for (const listener of saved) process.on("SIGINT", listener);
    });

    function startRun(pid: number) {
      let finish!: (r: { exitCode?: number }) => void;
      const proc = Object.assign(new Promise((r) => (finish = r)), { pid });
      mockExeca.mockReturnValue(proc);
      const kill = vi.spyOn(process, "kill").mockImplementation((() => {
        finish({ exitCode: undefined });
        return true;
      }) as any);
      const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      const running = new KiroAgent({ model: "m", homeDir }).run("p", { cwd: "/app" });
      return { running, kill, exit };
    }

    test("with no other handler, as in saaga doctor, it stops kiro's group and exits 130", async () => {
      const { running, kill, exit } = startRun(501);
      await Promise.resolve();
      process.emit("SIGINT", "SIGINT");
      await running;
      expect(kill).toHaveBeenCalledWith(-501, "SIGTERM");
      expect(exit).toHaveBeenCalledWith(130);
      expect(process.listenerCount("SIGINT")).toBe(0);
    });

    test("exiting mid-run deletes the temporary agent synchronously", async () => {
      const agentsDir = join(homeDir, ".kiro", "agents");
      let finish!: (r: { exitCode?: number }) => void;
      mockExeca.mockReturnValue(Object.assign(new Promise((r) => (finish = r)), { pid: 503 }));
      vi.spyOn(process, "kill").mockImplementation((() => true) as any);
      const exitListeners = process.listenerCount("exit");

      const running = new KiroAgent({ model: "m", homeDir }).run("p", {
        cwd: "/app",
        permissions: PERMS,
        additionalDirs: [runDir],
      });
      await vi.waitFor(() => expect(mockExeca).toHaveBeenCalled());
      expect(readdirSync(agentsDir)).toHaveLength(1);

      // What process.exit() does: run the exit listeners, which cannot await.
      for (const listener of process.listeners("exit")) listener(130);
      expect(existsSync(agentsDir)).toBe(false);

      finish({ exitCode: 0 });
      await running;
      expect(process.listenerCount("exit")).toBe(exitListeners);
    });

    test("with saaga run's handler present, it stops kiro's group but leaves exiting to that handler", async () => {
      const runHandler = vi.fn();
      process.on("SIGINT", runHandler);
      const { running, kill, exit } = startRun(502);
      await Promise.resolve();
      process.emit("SIGINT", "SIGINT");
      await running;
      expect(kill).toHaveBeenCalledWith(-502, "SIGTERM");
      expect(runHandler).toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
      expect(process.listeners("SIGINT")).toEqual([runHandler]);
    });
  });

  test("forwards denial events parsed from stream-json", async () => {
    async function* lines(): AsyncGenerator<string> {
      yield JSON.stringify({
        type: "sessionUpdate",
        data: {
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "t1",
            status: "failed",
            title: "Write File",
            locations: [{ path: "/app/src/x.ts" }],
            rawOutput: { message: "The user rejected this tool call." },
          },
        },
      }) + "\n";
    }
    mockExeca.mockReturnValue(fakeProc({ exitCode: 0 }, { pid: 1, stdout: lines() }));
    const events: unknown[] = [];

    await new KiroAgent({ model: "m", homeDir }).run("p", {
      cwd: "/app",
      onEvent: (e) => events.push(e),
    });

    expect(events).toEqual([
      {
        kind: "denial",
        tool: "Write File",
        path: "/app/src/x.ts",
        command: undefined,
        message: "The user rejected this tool call.",
      },
    ]);
    const args = mockExeca.mock.calls[0][1];
    expect(args).toContain("stream-json");
  });
});

describe("buildKiroPermissionRules", () => {
  const rules = buildKiroPermissionRules(PERMS);
  const find = (capability: string, effect: string) =>
    rules.filter((r) => r.capability === capability && r.effect === effect);

  test("allows each root in bare and subtree form", () => {
    expect(find("fs_read", "allow")).toEqual([
      { capability: "fs_read", match: ["/app", "/app/**"], effect: "allow" },
    ]);
    expect(find("fs_write", "allow")[0].match).toEqual([
      "/app/docs",
      "/app/docs/**",
      "/app/.saaga-runs/run-1",
      "/app/.saaga-runs/run-1/**",
    ]);
  });

  test("denies every write outside the write roots", () => {
    const [containment] = find("fs_write", "deny");
    expect(containment).toEqual({
      capability: "fs_write",
      match: ["**"],
      exclude: find("fs_write", "allow")[0].match,
      effect: "deny",
    });
  });

  test("denies deny paths for writes, passing globs through", () => {
    const [, explicit] = find("fs_write", "deny");
    expect(explicit.match).toEqual(["/app/AGENTS.md", "/app/AGENTS.md/**", "/app/.cursor/rules/**"]);
  });

  test("denies every read outside the read roots", () => {
    expect(find("fs_read", "deny")).toEqual([
      {
        capability: "fs_read",
        match: ["**"],
        exclude: find("fs_read", "allow")[0].match,
        effect: "deny",
      },
    ]);
  });

  test("restricted shell: bare and argument forms, git anchored on the subcommand", () => {
    const [allow] = find("shell", "allow");
    expect(allow.match).toContain("pwd");
    expect(allow.match).toContain("pwd *");
    expect(allow.match).toContain("git log");
    expect(allow.match).toContain("git log *");
    expect(allow.match).not.toContain("git *");
    expect(allow.match.some((m) => m.startsWith("git -"))).toBe(false);
  });

  test("restricted shell: every other command is denied", () => {
    const [allow] = find("shell", "allow");
    expect(find("shell", "deny")).toEqual([
      { capability: "shell", match: ["*"], exclude: allow.match, effect: "deny" },
    ]);
  });

  test("shell none: a single deny and no allow", () => {
    const none = buildKiroPermissionRules({ ...PERMS, shell: "none" });
    expect(none.filter((r) => r.capability === "shell")).toEqual([
      { capability: "shell", match: ["*"], effect: "deny" },
    ]);
  });

  test("denies the non-filesystem tool surface by exact capability name", () => {
    for (const cap of ["mcp", "power", "subagent", "skill", "web_fetch", "web_search"]) {
      expect(find(cap, "deny")).toEqual([{ capability: cap, match: ["*"], effect: "deny" }]);
    }
  });

  test("emits every real-path form of each path", () => {
    const withReal = buildKiroPermissionRules(PERMS, (p) =>
      p.startsWith("/app") ? [p, p.replace("/app", "/private/app")] : [p],
    );
    const read = withReal.find((r) => r.capability === "fs_read")!;
    expect(read.match).toEqual(["/app", "/app/**", "/private/app", "/private/app/**"]);
  });

  test("the filesystem root's subtree is /**, not //**", () => {
    const rootRules = buildKiroPermissionRules({ ...PERMS, readRoots: ["/"], writeRoots: ["/"] });
    const read = rootRules.find((r) => r.capability === "fs_read")!;
    expect(read.match).toEqual(["/", "/**"]);
    const containment = rootRules.find((r) => r.capability === "fs_write" && r.effect === "deny")!;
    expect(containment.exclude).toEqual(["/", "/**"]);
    const readContainment = rootRules.find((r) => r.capability === "fs_read" && r.effect === "deny")!;
    expect(readContainment.exclude).toEqual(["/", "/**"]);
    expect(JSON.stringify(rootRules)).not.toContain("//**");
  });

  test("omits the explicit deny rule when there are no deny paths", () => {
    const bare = buildKiroPermissionRules({ ...PERMS, denyPaths: [] });
    expect(bare.filter((r) => r.capability === "fs_write" && r.effect === "deny")).toHaveLength(1);
  });
});

describe("realPathForms", () => {
  test("adds the resolved form of a symlinked path, even for paths not yet created", () => {
    const real = join(scratch, "real");
    const link = join(scratch, "link");
    mkdirSync(real);
    symlinkSync(real, link);
    const resolved = realpathSync(real);

    expect(realPathForms(join(link, "docs", "new.md"))).toEqual([
      join(link, "docs", "new.md"),
      join(resolved, "docs", "new.md"),
    ]);
    expect(realPathForms(join(link, "rules", "**"))).toEqual([
      join(link, "rules", "**"),
      join(resolved, "rules", "**"),
    ]);
  });

  test("returns a path that is already real unchanged", () => {
    const real = realpathSync(scratch);
    expect(realPathForms(join(real, "x"))).toEqual([join(real, "x")]);
  });
});

describe("sweepStaleProfiles", () => {
  test("deletes only old files carrying Saaga's name and marker", async () => {
    const dir = join(homeDir, "agents");
    mkdirSync(dir);
    const marked = JSON.stringify({ description: KIRO_PROFILE_MARKER });
    const files = {
      "saaga-aa11.json": marked, // old and marked, so the sweep deletes it
      "saaga-bb22.json": JSON.stringify({ description: "mine" }), // old but not marked
      "saaga-cc33.json": marked, // marked but recent, as from a live run
      "other.json": marked, // marked but without Saaga's name prefix
    };
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    for (const name of ["saaga-aa11.json", "saaga-bb22.json", "other.json"]) {
      utimesSync(join(dir, name), old, old);
    }

    await sweepStaleProfiles(dir);

    expect(readdirSync(dir).sort()).toEqual(["other.json", "saaga-bb22.json", "saaga-cc33.json"]);
  });

  test("tolerates a missing directory", async () => {
    await expect(sweepStaleProfiles(join(homeDir, "nope"))).resolves.toBeUndefined();
  });
});

describe("watchForLoginFlow", () => {
  async function collect(chunks: string[]): Promise<{ out: string; calls: number }> {
    async function* source(): AsyncGenerator<string> {
      yield* chunks;
    }
    let calls = 0;
    let out = "";
    for await (const chunk of watchForLoginFlow(source(), () => calls++)) out += chunk;
    return { out, calls };
  }

  test("passes the stream through and fires once on the marker, even split", async () => {
    const { out, calls } = await collect(SPINNER);
    expect(out).toBe(SPINNER.join(""));
    expect(calls).toBe(1);
  });

  test("ignores the phrase inside agent output, where a carriage return is escaped", async () => {
    const quoted = JSON.stringify({
      type: "sessionUpdate",
      data: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "The login screen shows \r▰▱ Opening browser... | Press (^) + C to cancel" },
        },
      },
    });
    const { calls } = await collect([quoted + "\n", "Opening browser... in plain prose\n"]);
    expect(calls).toBe(0);
  });

  test("ignores ordinary JSON output", async () => {
    const { calls } = await collect(['{"type":"runStarted"}\n', '{"type":"runFinished"}\n']);
    expect(calls).toBe(0);
  });
});
