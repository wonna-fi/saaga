import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execa, type ResultPromise } from "execa";
import { parseJsonLine, type AgentEvent, type EventParser } from "./events.js";
import { enumerateExcludedPaths, ALLOWED_SHELL_COMMANDS } from "./permissions.js";
import { awaitProcess } from "./spawn.js";
import { buildPipedStdio, buildStdio } from "./stdio.js";
import type { Agent, AgentRunOpts, AgentRunResult } from "./types.js";

export interface CursorAgentOptions {
  model: string;
  ci?: boolean;
}

export class CursorAgent implements Agent {
  readonly name = "cursor";
  private readonly model: string;
  private readonly ci: boolean;

  constructor(opts: CursorAgentOptions) {
    this.model = opts.model;
    this.ci = opts.ci ?? false;
  }

  async run(prompt: string, opts: AgentRunOpts): Promise<AgentRunResult> {
    const { args, env: execEnv } = await buildCursorExecaOpts(
      opts.model ?? this.model,
      prompt,
      opts,
    );
    const stdio = opts.onEvent ? buildPipedStdio(opts) : buildStdio(opts);

    let proc: ResultPromise;
    try {
      proc = execa("cursor-agent", args, {
        cwd: opts.cwd,
        reject: false,
        cancelSignal: opts.signal,
        ...(execEnv ? { env: execEnv } : {}),
        ...stdio,
      });
    } catch {
      return { exitCode: 1 };
    }

    const exitCode = await awaitProcess(
      proc,
      opts.onEvent && { parser: createCursorEventParser(), sink: opts.onEvent },
    );
    return { exitCode };
  }
}

/**
 * Parse cursor's `stream-json` output.
 *
 * Cursor uses three distinct result shapes for refusals:
 * - `writePermissionDenied` on editToolCall — carries `{ path, error }`.
 * - `rejected` on shellToolCall, editToolCall, deleteToolCall — carries
 *   `{ command?, path?, reason, isReadonly? }`.
 * - `error` on readToolCall — carries `{ errorMessage }` where the message
 *   may or may not indicate a permission denial.
 */
export function createCursorEventParser(): EventParser {
  return {
    push(line: string): AgentEvent[] {
      const obj = parseJsonLine(line);
      if (!obj || obj.type !== "tool_call" || obj.subtype !== "completed") return [];
      const call = obj.tool_call as Record<string, unknown> | undefined;
      if (!call) return [];

      const events: AgentEvent[] = [];
      for (const [callKey, callValue] of Object.entries(call)) {
        if (!callKey.endsWith("ToolCall")) continue;
        const toolVal = callValue as {
          args?: Record<string, unknown>;
          result?: Record<string, unknown>;
        } | undefined;
        const result = toolVal?.result;
        if (!result || typeof result !== "object") continue;
        const args = toolVal?.args ?? {};
        const tool = callKey.replace(/ToolCall$/, "");

        if (result.writePermissionDenied) {
          const info = result.writePermissionDenied as { path?: string; error?: string };
          const message = info.error ?? "writePermissionDenied";
          events.push({
            kind: "denial",
            tool,
            path: info.path || extractDeniedPath(message),
            message,
          });
        }

        if (result.rejected && typeof result.rejected === "object") {
          const r = result.rejected as Record<string, unknown>;
          events.push({
            kind: "denial",
            tool,
            path: (r.path as string) || (args.path as string) || undefined,
            command: (r.command as string) || (args.command as string) || undefined,
            message: (r.reason as string) || (r.command as string) || "rejected",
          });
        }

        if (result.error && typeof result.error === "object") {
          const e = result.error as { errorMessage?: string };
          if (e.errorMessage?.toLowerCase().includes("permission denied")) {
            events.push({
              kind: "denial",
              tool,
              path: (args.path as string) || undefined,
              message: e.errorMessage,
            });
          }
        }
      }
      return events;
    },
  };
}

/** Pull the target out of "Write permission denied: /path: Blocked by …". */
function extractDeniedPath(message: string): string | undefined {
  return /permission denied:\s*(.+?):/i.exec(message)?.[1];
}

async function buildCursorExecaOpts(
  model: string,
  prompt: string,
  opts: AgentRunOpts,
): Promise<{ args: string[]; env?: Record<string, string> }> {
  if (!opts.permissions) {
    return {
      args: [
        "--print",
        "--force",
        "--model",
        model,
        "--output-format",
        "text",
        prompt,
      ],
    };
  }

  const { env } = await writeCursorConfig(opts);
  return {
    args: [
      "--print",
      "--trust",
      "--model",
      model,
      "--output-format",
      opts.onEvent ? "stream-json" : "text",
      prompt,
    ],
    env,
  };
}

/**
 * Generate cli-config.json under `<runDir>/.cursor-cli/` and return
 * the env override that points `CURSOR_CONFIG_DIR` there.
 *
 * Cursor in print mode with `--trust` enforces deny rules only: reads and
 * writes are permitted by default and an `allow` entry cannot narrow that,
 * so the permitted set is expressed by enumerating everything outside it.
 * A blanket `Write(*)` is not usable here — it also swallows the writeRoots,
 * since deny takes precedence over any allow.
 *
 * Shell is the exception. It is default-deny, so `allow` is the right lever
 * and the restricted shell commands (utilities + read-only git) are listed there.
 */
async function writeCursorConfig(
  opts: AgentRunOpts,
): Promise<{ configDir: string; env: Record<string, string> }> {
  const perms = opts.permissions!;
  const runDir = opts.additionalDirs?.[0];
  if (!runDir) {
    throw new Error("CursorAgent: restricted mode requires additionalDirs[0] as runDir");
  }

  const configDir = join(runDir, ".cursor-cli");
  await mkdir(configDir, { recursive: true });

  const deny = new Set<string>();
  for (const path of await enumerateExcludedPaths(perms.readRoots)) {
    for (const rule of pathRules(["Read", "Write", "Edit"], path)) deny.add(rule);
  }
  for (const path of await enumerateExcludedPaths(perms.writeRoots)) {
    for (const rule of pathRules(["Write", "Edit"], path)) deny.add(rule);
  }
  for (const path of perms.denyPaths) {
    for (const rule of pathRules(["Write", "Edit"], path)) deny.add(rule);
  }

  const allow: string[] = [];
  if (perms.shell === "restricted") {
    for (const cmd of ALLOWED_SHELL_COMMANDS.utilities) {
      allow.push(`Shell(${cmd}:*)`);
    }
    for (const sub of ALLOWED_SHELL_COMMANDS.git) {
      allow.push(`Shell(git:${sub}*)`);
    }
  }

  const config = {
    permissions: {
      allow,
      deny: [...deny],
    },
  };

  await writeFile(
    join(configDir, "cli-config.json"),
    JSON.stringify(config, null, 2) + "\n",
  );

  return {
    configDir,
    env: { CURSOR_CONFIG_DIR: configDir },
  };
}

/**
 * Emit each rule kind for `path` in both bare and glob form, since a
 * directory only matches with the `/**` suffix and a file only without it.
 */
function pathRules(kinds: string[], path: string): string[] {
  if (path.endsWith("*")) return kinds.map((kind) => `${kind}(${path})`);
  return kinds.flatMap((kind) => [`${kind}(${path})`, `${kind}(${path}/**)`]);
}
