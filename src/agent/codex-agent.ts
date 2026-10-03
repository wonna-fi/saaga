import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import { execa, type ResultPromise } from "execa";

import { CODEX_HOOK_SCRIPT } from "./codex-hook.js";
import { parseJsonLine, type AgentEvent, type EventParser } from "./events.js";
import { ALLOWED_SHELL_COMMANDS, type AgentPermissions } from "./permissions.js";
import { awaitProcess } from "./spawn.js";
import { buildPipedStdio, buildStdio } from "./stdio.js";
import type { Agent, AgentRunOpts, AgentRunResult } from "./types.js";

export interface CodexAgentOptions {
  model: string;
  fast?: boolean;
  /** Finds the codex executable the restricted sandbox must read; injected by tests. */
  probeExecutable?: (cwd: string, signal?: AbortSignal) => Promise<string | undefined>;
}

export class CodexAgent implements Agent {
  readonly name = "codex";

  constructor(private readonly opts: CodexAgentOptions) {}

  async run(prompt: string, opts: AgentRunOpts): Promise<AgentRunResult> {
    const probe = this.opts.probeExecutable ?? probeCodexExecutable;
    const executable = opts.permissions ? await probe(opts.cwd, opts.signal) : undefined;
    if (opts.permissions) {
      // Codex cannot create a missing writable root inside its read-only parent.
      // Materialize only the roots that survive the protected-path exclusions.
      for (const [path, access] of Object.entries(codexFilesystem(opts.permissions, opts.cwd, executable))) {
        if (access === "write") await mkdir(path, { recursive: true });
      }
    }
    const args = buildCodexArgs(opts.model ?? this.opts.model, prompt, opts, this.opts.fast, executable);
    const stdio = opts.onEvent ? buildPipedStdio(opts) : buildStdio(opts);
    const parser = createCodexEventParser();
    const sink = opts.onEvent;
    if (sink) {
      const stderrSinks: unknown[] = Array.isArray(stdio.stderr)
        ? stdio.stderr as unknown[] : [stdio.stderr];
      // Codex emits hook rejections on stderr, without a JSONL item. Transform
      // stderr as it streams to its normal sinks; do not leave a pipe undrained.
      stdio.stderr = [{
        preserveNewlines: true,
        *transform(line: unknown) {
          if (typeof line === "string") {
            for (const event of parser.push(line)) sink(event);
          }
          yield line;
        },
      }, ...stderrSinks];
    }
    let proc: ResultPromise;
    try {
      proc = execa("codex", args, {
        cwd: opts.cwd,
        reject: false,
        cancelSignal: opts.signal,
        ...stdio,
      });
    } catch {
      return { exitCode: 1 };
    }
    return { exitCode: await awaitProcess(
      proc,
      sink && { parser, sink },
    ) };
  }
}

type TomlValue = string | boolean | TomlValue[] | { [key: string]: TomlValue };

/** Inline tables avoid dotted CLI keys splitting paths that contain periods. */
function toml(value: TomlValue): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(toml).join(", ")}]`;
  return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)} = ${toml(v)}`).join(", ")}}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export const CODEX_SHELL_COMMANDS = {
  utilities: [...ALLOWED_SHELL_COMMANDS.utilities, "cat", "rg"],
  git: [...ALLOWED_SHELL_COMMANDS.git],
};

/**
 * How bubblewrap reports that it could not start codex's own binary. Only the prefix is matched: the
 * reason after the last colon is `strerror` text, which a locale may translate.
 */
const SANDBOX_EXEC_FAILURE = /^bwrap: execvp (.+): [^:\n]*$/m;

/**
 * The codex executable the restricted sandbox must be able to read, or undefined when the sandbox
 * starts without it. On Linux, codex runs each shell command by starting its own native binary again
 * inside bubblewrap, which mounts only what the profile grants; `:minimal` covers system
 * directories, not a standalone install under `~/.codex/packages` or a package under a user's Node
 * prefix. The file on `PATH` may be a shim (npm, Volta, asdf, a wrapper script), so the binary is not
 * looked up here: codex is asked, by running `true` in its own sandbox with only `:minimal` readable,
 * from the directory and `PATH` the real run uses, and it names the binary it could not execute. No
 * model is called. Only that one file is granted, never its directory, which could be `$HOME`.
 *
 * The real run ignores user config and pins the project untrusted; `codex sandbox` takes neither
 * flag, so the probe gets an empty `CODEX_HOME` instead, and `LC_ALL=C` keeps its output parseable.
 */
export async function probeCodexExecutable(cwd: string, signal?: AbortSignal): Promise<string | undefined> {
  const profile = toml({ filesystem: { ":minimal": "read" }, network: { enabled: false } });
  let home: string | undefined;
  try {
    home = await mkdtemp(join(tmpdir(), "saaga-codex-probe-"));
    const result = await execa("codex", [
      "sandbox", "--config", 'default_permissions="saaga-probe"',
      "--config", `permissions={"saaga-probe" = ${profile}}`, "--", "true",
    ], {
      cwd, reject: false, timeout: 30_000, stdin: "ignore",
      env: { CODEX_HOME: home, LC_ALL: "C" },
      ...(signal ? { cancelSignal: signal } : {}),
    });
    return String(result.stderr ?? "").match(SANDBOX_EXEC_FAILURE)?.[1];
  } catch {
    return undefined;
  } finally {
    if (home) await rm(home, { recursive: true, force: true });
  }
}

export function buildCodexArgs(
  model: string,
  prompt: string,
  opts: AgentRunOpts,
  fast = false,
  executable?: string,
): string[] {
  const args = [
    "exec", "--model", model, "--ephemeral", "--skip-git-repo-check", "--color", "never",
    ...(opts.onEvent ? ["--json"] : []),
  ];
  const config: Record<string, TomlValue> = {
    approval_policy: "never",
    service_tier: fast ? "fast" : "default",
  };
  if (opts.permissions) {
    args.push("--ignore-user-config", "--ignore-rules", "--strict-config", "--dangerously-bypass-hook-trust");
    Object.assign(config, restrictedConfig(opts.permissions, opts.cwd, executable));
  } else {
    args.push("--dangerously-bypass-approvals-and-sandbox");
    config["features.fast_mode"] = true;
  }
  for (const [key, value] of Object.entries(config)) args.push("--config", `${key}=${toml(value)}`);
  return [...args, "--", prompt];
}

function codexFilesystem(
  permissions: AgentPermissions,
  cwd: string,
  executable?: string,
): Record<string, "read" | "write"> {
  const filesystem: Record<string, "read" | "write"> = { ":minimal": "read" };
  const protectedPaths = permissions.denyPaths.map(path => resolve(cwd, path.replace(/[/\\]\*\*$/, "")));
  for (const root of [cwd, ...permissions.writeRoots]) {
    for (const name of [".git", ".codex", ".agents"]) protectedPaths.push(resolve(cwd, root, name));
  }
  for (const root of permissions.readRoots) filesystem[resolve(cwd, root)] = "read";
  for (const root of permissions.writeRoots) {
    const path = resolve(cwd, root);
    if (!protectedPaths.some(protectedPath => path === protectedPath || path.startsWith(protectedPath + sep))) {
      filesystem[path] = "write";
    }
  }
  // Protected files must remain readable, including AGENTS.md and the corpus
  // navigation. A more specific read rule removes their parent's write grant.
  for (const path of protectedPaths) filesystem[path] = "read";
  // Codex needs its own binary inside the sandbox; see probeCodexExecutable. A root
  // that already covers it keeps its grant, since a nested read would narrow it.
  if (executable && !Object.keys(filesystem).some(root => executable === root || executable.startsWith(root + sep))) {
    filesystem[executable] = "read";
  }
  return filesystem;
}

function restrictedConfig(
  permissions: AgentPermissions,
  cwd: string,
  executable?: string,
): Record<string, TomlValue> {
  const filesystem = codexFilesystem(permissions, cwd, executable);
  const policy = JSON.stringify({ ...CODEX_SHELL_COMMANDS, shell: permissions.shell });
  const command = `${shellQuote(process.execPath)} -e ${shellQuote(CODEX_HOOK_SCRIPT)} ${shellQuote(policy)}`;
  return {
    default_permissions: "saaga",
    permissions: { saaga: { filesystem, network: { enabled: false } } },
    // Ignoring user config also removes project trust grants. Pin this project
    // as untrusted so its config and hooks cannot widen an unattended run.
    projects: { [resolve(cwd)]: { trust_level: "untrusted" } },
    web_search: "disabled",
    allow_login_shell: false,
    features: {
      fast_mode: true, hooks: true, shell_tool: permissions.shell !== "none",
      unified_exec: false, shell_snapshot: false, multi_agent: false,
      apps: false, plugins: false, code_mode_host: true,
      browser_use: false, computer_use: false, image_generation: false,
      memories: false, skill_mcp_dependency_install: false,
    },
    shell_environment_policy: { inherit: "none", set: { PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" } },
    hooks: { PreToolUse: [{ hooks: [{ type: "command", command }] }] },
  };
}

const DENIAL = /Saaga policy:|permission denied|operation not permitted|read-only file system|rejected by user|blocked by|denied by|sandbox.*(?:denied|violation)|outside.*(?:workspace|writable)/i;

/** Codex exec JSONL reports token usage but does not announce a tool list. */
export function createCodexEventParser(): EventParser {
  return {
    push(line: string): AgentEvent[] {
      const nativeError = line.match(/^(?:\d{4}-\d{2}-\d{2}T\S+\s+)?ERROR codex_core::tools::router: error=(.*)/)?.[1];
      const blocked = nativeError?.match(/^Command blocked by PreToolUse hook: (Saaga policy:.*?)\. Command: (.*)/);
      if (blocked) return [{ kind: "denial", tool: "shell", message: blocked[1], command: blocked[2] }];
      if (nativeError?.startsWith("patch rejected:") && DENIAL.test(nativeError)) {
        return [{ kind: "denial", tool: "apply_patch", message: nativeError }];
      }
      const obj = parseJsonLine(line);
      if (!obj) return [];
      if (obj.type === "turn.completed") {
        const usage = record(obj.usage);
        return [{
          kind: "usage",
          inputTokens: number(usage.input_tokens),
          outputTokens: number(usage.output_tokens),
          cacheReadTokens: number(usage.cached_input_tokens),
          cacheCreationTokens: number(usage.cache_write_input_tokens),
        }];
      }
      if (obj.type !== "item.completed") return [];
      const item = record(obj.item);
      if (item.type !== "command_execution" && item.type !== "file_change") return [];
      const message = typeof item.aggregated_output === "string" ? item.aggregated_output : "";
      if (!DENIAL.test(message)) return [];
      if (item.type === "command_execution") {
        if (item.exit_code === 0) return [];
        return [{ kind: "denial", tool: "shell", message,
          command: typeof item.command === "string" ? item.command : undefined }];
      }
      if (item.status !== "failed") return [];
      const changes = Array.isArray(item.changes) ? item.changes : [];
      return changes.map((change: unknown) => ({
        kind: "denial", tool: "apply_patch", message,
        path: typeof record(change).path === "string" ? record(change).path as string : undefined,
      }));
    },
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
