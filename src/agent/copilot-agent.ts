import { randomBytes } from "node:crypto";
import { rename, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { execa, type ResultPromise } from "execa";
import { parseJsonLine, type AgentEvent, type EventParser } from "./events.js";
import { ALLOWED_SHELL_COMMANDS } from "./permissions.js";
import { awaitProcess } from "./spawn.js";
import { buildPipedStdio, buildStdio } from "./stdio.js";
import type { Agent, AgentRunOpts, AgentRunResult } from "./types.js";

export interface CopilotAgentOptions {
  model: string;
  ci?: boolean;
}

/**
 * Adapter for the GitHub Copilot CLI.
 *
 * Copilot's glob indexer respects `.gitignore`, which interferes with
 * documentation runs that need to read files like `dist/` or build
 * outputs. We rename `.gitignore` to `.gitignore.<hex>.bak` before
 * invoking the CLI and restore it afterwards (including on failure).
 *
 * Copilot restricts file access to `cwd`, its subdirectories, and (unless
 * `--disallow-temp-dir` is passed) the system temp directory.
 * `opts.additionalDirs` is granted via `--add-dir`.
 */
export class CopilotAgent implements Agent {
  readonly name = "copilot";
  private readonly model: string;

  constructor(opts: CopilotAgentOptions) {
    this.model = opts.model;
  }

  async run(prompt: string, opts: AgentRunOpts): Promise<AgentRunResult> {
    const giPath = resolve(opts.cwd, ".gitignore");
    const suffix = randomBytes(4).toString("hex");
    const giBakPath = resolve(opts.cwd, `.gitignore.${suffix}.bak`);
    const overridden = await tryRename(giPath, giBakPath);

    try {
      const args = buildCopilotArgs(this.model, prompt, opts);

      const stdio = opts.onEvent ? buildPipedStdio(opts) : buildStdio(opts);

      let proc: ResultPromise;
      try {
        proc = execa("copilot", args, {
          cwd: opts.cwd,
          reject: false,
          cancelSignal: opts.signal,
          ...stdio,
        });
      } catch {
        return { exitCode: 1 };
      }
      const exitCode = await awaitProcess(
        proc,
        opts.onEvent && { parser: createCopilotEventParser(), sink: opts.onEvent },
      );
      return { exitCode };
    } finally {
      if (overridden) {
        await tryRename(giBakPath, giPath);
      }
    }
  }
}

/**
 * Parse copilot's `json` (JSONL) output.
 *
 * A refusal carries `error.code: "denied"`, an enum rather than a message to
 * match on. The targeted path lives on the originating tool request, so the
 * two have to be correlated by call id.
 */
export function createCopilotEventParser(): EventParser {
  const pending = new Map<string, { tool: string; path?: string; command?: string }>();

  return {
    push(line: string): AgentEvent[] {
      const obj = parseJsonLine(line);
      if (!obj) return [];
      const data = (obj.data ?? {}) as Record<string, unknown>;

      if (obj.type === "assistant.message" && Array.isArray(data.toolRequests)) {
        for (const req of data.toolRequests as Record<string, unknown>[]) {
          if (typeof req.toolCallId !== "string") continue;
          const args = (req.arguments ?? {}) as Record<string, unknown>;
          pending.set(req.toolCallId, {
            tool: typeof req.name === "string" ? req.name : "unknown",
            path: typeof args.path === "string" ? args.path : undefined,
            command: typeof args.command === "string" ? args.command : undefined,
          });
        }
      }

      if (obj.type === "tool.execution_complete") {
        const error = (data.error ?? {}) as { code?: string; message?: string };
        if (error.code !== "denied") return [];
        const origin =
          typeof data.toolCallId === "string" ? pending.get(data.toolCallId) : undefined;
        return [
          {
            kind: "denial",
            tool: origin?.tool ?? "unknown",
            path: origin?.path,
            command: origin?.command,
            message: error.message ?? "denied",
          },
        ];
      }

      return [];
    },
  };
}

function buildCopilotArgs(
  model: string,
  prompt: string,
  opts: AgentRunOpts,
): string[] {
  if (!opts.permissions) {
    const args = [
      "-p",
      prompt,
      "--allow-all-tools",
      "--no-ask-user",
      "--model",
      model,
      "--no-auto-update",
    ];
    for (const dir of opts.additionalDirs ?? []) {
      args.push("--add-dir", dir);
    }
    return args;
  }

  return buildRestrictedCopilotArgs(model, prompt, opts);
}

/**
 * Tools the model may use under a restricted profile.
 *
 * `bash` is included only when the profile permits the restricted shell
 * allowance. Keeping the surface explicit also excludes web fetch and MCP
 * tools.
 */
const RESTRICTED_FILE_TOOLS = ["view", "create", "edit", "glob", "grep"];

function restrictedShellAllowRules(): string[] {
  return [
    ...ALLOWED_SHELL_COMMANDS.utilities.map((command) => `shell(${command}:*)`),
    ...ALLOWED_SHELL_COMMANDS.git.map((subcommand) => `shell(git:${subcommand}*)`),
  ];
}

/**
 * Build copilot args under a restricted profile.
 *
 * `--available-tools` controls the tools visible to the model. `--allow-tool`
 * grants non-interactive permission to individual tools and shell command
 * patterns, without granting the rest of the shell surface. Copilot cannot
 * scope writes within the workspace, so only the workspace boundary is
 * enforced for file changes.
 *
 * `--disallow-temp-dir` matters because copilot otherwise grants the system
 * temp directory automatically, which would leave a hole in that boundary.
 */
function buildRestrictedCopilotArgs(
  model: string,
  prompt: string,
  opts: AgentRunOpts,
): string[] {
  const perms = opts.permissions!;
  const shellRules = perms.shell === "restricted" ? restrictedShellAllowRules() : [];
  const args = [
    "-p",
    prompt,
    "--no-ask-user",
    "--model",
    model,
    "--no-auto-update",
    "--available-tools",
    ...RESTRICTED_FILE_TOOLS,
    ...(perms.shell === "restricted" ? ["bash"] : []),
    "--allow-tool",
    ["write", ...shellRules].join(","),
    "--disallow-temp-dir",
    ...(opts.onEvent ? ["--output-format", "json"] : []),
  ];

  const dirs = new Set(opts.additionalDirs ?? []);
  for (const root of [...perms.readRoots, ...perms.writeRoots]) {
    if (!isInside(root, opts.cwd)) dirs.add(root);
  }
  for (const dir of dirs) {
    args.push("--add-dir", dir);
  }

  return args;
}

function isInside(path: string, base: string): boolean {
  return path === base || path.startsWith(base + sep);
}

async function tryRename(from: string, to: string): Promise<boolean> {
  if (!(await pathExists(from))) return false;
  await rename(from, to);
  return true;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
