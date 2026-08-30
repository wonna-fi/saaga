import { execa, type ResultPromise } from "execa";
import {
  parseJsonLine,
  type AgentEvent,
  type EventParser,
} from "./events.js";
import {
  ALLOWED_SHELL_COMMANDS,
  type AgentPermissions,
} from "./permissions.js";
import { awaitProcess } from "./spawn.js";
import { buildPipedStdio, buildStdio } from "./stdio.js";
import type { Agent, AgentRunOpts, AgentRunResult } from "./types.js";

export interface ClaudeAgentOptions {
  model: string;
  ci?: boolean;
}

export class ClaudeAgent implements Agent {
  readonly name = "claude";
  private readonly model: string;
  private readonly ci: boolean;

  constructor(opts: ClaudeAgentOptions) {
    this.model = opts.model;
    this.ci = opts.ci ?? false;
  }

  async run(prompt: string, opts: AgentRunOpts): Promise<AgentRunResult> {
    const args = buildClaudeArgs(opts.model ?? this.model, prompt, opts);
    const stdio = opts.onEvent ? buildPipedStdio(opts) : buildStdio(opts);

    let proc: ResultPromise;
    try {
      proc = execa("claude", args, {
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
      opts.onEvent && { parser: createClaudeEventParser(), sink: opts.onEvent },
    );
    return { exitCode };
  }
}

/**
 * Messages claude emits when its permission layer refuses a call.
 *
 * These come from the CLI rather than the model, so they are stable within a
 * version. Unlike cursor and copilot, claude reports a permission refusal
 * with the same `is_error` flag it uses for ordinary tool failures, so a
 * pattern is needed to tell the two apart.
 */
const CLAUDE_DENIAL_PATTERNS = [
  /denied by your permission settings/i,
  /permission to use .* has been denied/i,
  /blocked by permission/i,
];

/**
 * Parse claude's `stream-json` output.
 *
 * A refusal arrives as a `tool_result` carrying only the originating call's
 * id, so the targeted path or command has to be recovered from the `tool_use`
 * seen earlier in the stream.
 */
export function createClaudeEventParser(): EventParser {
  const pending = new Map<string, { tool: string; path?: string; command?: string }>();

  return {
    push(line: string): AgentEvent[] {
      const obj = parseJsonLine(line);
      if (!obj) return [];
      const events: AgentEvent[] = [];

      if (obj.type === "system" && obj.subtype === "init" && Array.isArray(obj.tools)) {
        events.push({ kind: "session", tools: obj.tools as string[] });
      }

      if (obj.type === "result") {
        const usage = (obj.usage ?? {}) as Record<string, unknown>;
        events.push({
          kind: "usage",
          turns: asNumber(obj.num_turns),
          inputTokens: asNumber(usage.input_tokens),
          outputTokens: asNumber(usage.output_tokens),
          cacheReadTokens: asNumber(usage.cache_read_input_tokens),
          cacheCreationTokens: asNumber(usage.cache_creation_input_tokens),
          costUsd: asNumber(obj.total_cost_usd),
          durationMs: asNumber(obj.duration_ms),
        });
      }

      const message = obj.message as { content?: unknown } | undefined;
      const content = Array.isArray(message?.content) ? message.content : [];
      for (const block of content as Record<string, unknown>[]) {
        if (block.type === "tool_use" && typeof block.id === "string") {
          const input = (block.input ?? {}) as Record<string, unknown>;
          const path = input.file_path ?? input.path ?? input.notebook_path;
          pending.set(block.id, {
            tool: typeof block.name === "string" ? block.name : "unknown",
            path: typeof path === "string" ? path : undefined,
            command: typeof input.command === "string" ? input.command : undefined,
          });
        }
        if (block.type === "tool_result" && block.is_error === true) {
          const text = extractText(block.content);
          if (!CLAUDE_DENIAL_PATTERNS.some((p) => p.test(text))) continue;
          const origin =
            typeof block.tool_use_id === "string" ? pending.get(block.tool_use_id) : undefined;
          events.push({
            kind: "denial",
            tool: origin?.tool ?? "unknown",
            path: origin?.path,
            command: origin?.command,
            message: text.replace(/<\/?tool_use_error>/g, "").trim(),
          });
        }
      }
      return events;
    },
  };
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (typeof c === "object" && c && "text" in c ? String((c as { text: unknown }).text) : ""))
    .join(" ");
}

function buildClaudeArgs(
  model: string,
  prompt: string,
  opts: AgentRunOpts,
): string[] {
  if (!opts.permissions) {
    return [
      "--print",
      "--dangerously-skip-permissions",
      "--model",
      model,
      prompt,
    ];
  }

  const settings = buildClaudeSettings(opts.permissions, opts.cwd);
  return [
    "--print",
    "--permission-mode",
    "dontAsk",
    // Without --mcp-config this leaves the session with no MCP servers,
    // so an ambient user or project config cannot widen the tool surface.
    "--strict-mcp-config",
    ...(opts.onEvent ? ["--verbose", "--output-format", "stream-json"] : []),
    "--model",
    model,
    "--settings",
    JSON.stringify(settings),
    prompt,
  ];
}

/**
 * The tool surface a restricted run should be left with.
 *
 * Asserted by the `claude/tool-surface` probe, which reads the toolset claude
 * announces at session start. Includes Bash when shell is restricted; Bash
 * remains available as a tool while command rules constrain what can run.
 */
export const CLAUDE_RESTRICTED_TOOLS: readonly string[] = [
  "Bash",
  "Edit",
  "Read",
  "Write",
];

/**
 * Tools withheld from a restricted run.
 *
 * Claude has no exclusive allowlist — `--allowedTools` / `permissions.allow`
 * grant named or scoped permissions rather than narrowing the tool surface —
 * so unwanted tools have to be denied by name. That leaves the list
 * open-ended: a tool introduced in a later release arrives enabled. The
 * `claude/tool-surface` probe exists to catch that.
 *
 * Bash is omitted here and handled separately: a bare `Bash` deny takes
 * precedence over every scoped allow, so it is emitted only for
 * `shell: "none"`. Under `shell: "restricted"`, scoped `Bash(...)` allows
 * pre-approve the canonical commands under `--permission-mode dontAsk`.
 *
 * Note that `--setting-sources ''` would be a tempting way to stop ambient
 * config from re-enabling these, but it also stops `CLAUDE.md` from loading,
 * which would silently disable the rule files saaga installs.
 */
const DENIED_TOOLS: readonly string[] = [
  "CronCreate",
  "CronDelete",
  "CronList",
  "DesignSync",
  "EnterWorktree",
  "ExitWorktree",
  "ListAgents",
  "Monitor",
  "NotebookEdit",
  "PushNotification",
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
];

/**
 * Claude runs a built-in set of Bash commands without a permission prompt in
 * every mode, including `dontAsk`. `permissions.allow` is therefore not an
 * exclusive Bash allowlist: anything in that built-in set still runs unless
 * it is denied explicitly. These patterns cover the documented built-ins that
 * fall outside Saaga's restricted policy, plus extras observed in live
 * testing (`sha256sum`, `python3`, `uname`, `date`).
 */
const CLAUDE_BUILTIN_BASH_DENY: readonly string[] = [
  "Bash(cat *)",
  "Bash(echo *)",
  "Bash(find *)",
  "Bash(which *)",
  "Bash(diff *)",
  "Bash(stat *)",
  "Bash(du *)",
  "Bash(sha256sum *)",
  "Bash(md5sum *)",
  "Bash(python *)",
  "Bash(python3 *)",
  "Bash(uname *)",
  "Bash(date *)",
  "Bash(env *)",
];

function restrictedBashAllowRules(): string[] {
  return [
    ...ALLOWED_SHELL_COMMANDS.utilities.map((command) => `Bash(${command}:*)`),
    ...ALLOWED_SHELL_COMMANDS.git.map((subcommand) => `Bash(git ${subcommand}:*)`),
  ];
}

/**
 * Build the Claude CLI settings JSON that expresses the permission profile.
 *
 * Gotchas encoded here (all verified by live testing):
 * - `Edit(path)` not `Write(path)` — Write rules are ignored by file checks.
 * - Double-slash for absolute paths: `//abs/path/**` not `/abs/path/**`.
 * - `additionalDirectories` grants reach but not edit rights — a matching
 *   `Edit` rule must also be present.
 * - Under `dontAsk`, mutating/untrusted Bash is auto-denied, but Claude's
 *   built-in read-only Bash set still runs unless denied by name. Scoped
 *   `Bash(command:*)` / `Bash(git subcommand:*)` allows pre-approve the
 *   restricted policy; `CLAUDE_BUILTIN_BASH_DENY` closes the built-in gap.
 *   A bare `Bash` deny defeats those allows, so it is used only when the
 *   profile sets `shell: "none"`.
 */
function buildClaudeSettings(
  perms: AgentPermissions,
  cwd: string,
): Record<string, unknown> {
  const allow: string[] = [];
  const deny: string[] = [...DENIED_TOOLS];

  for (const root of perms.writeRoots) {
    allow.push(`Edit(//${root}/**)`);
  }

  if (perms.shell === "restricted") {
    allow.push(...restrictedBashAllowRules());
    deny.push(...CLAUDE_BUILTIN_BASH_DENY);
  } else {
    deny.push("Bash");
  }

  for (const denied of perms.denyPaths) {
    deny.push(`Edit(//${denied})`);
  }

  // Claude restricts Read/Glob/Grep to cwd and additionalDirectories.
  // Without listing every root here, --allow-dir paths get Edit rules but
  // remain invisible to reads — the bug Bugbot caught.
  const reach = new Set<string>();
  for (const root of [...perms.readRoots, ...perms.writeRoots]) {
    if (root !== cwd && !root.startsWith(cwd + "/")) reach.add(root);
  }

  return {
    permissions: {
      allow,
      deny,
      additionalDirectories: [...reach],
    },
  };
}
