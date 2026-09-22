import { randomBytes } from "node:crypto";
import { realpathSync, rmdirSync, unlinkSync } from "node:fs";
import { mkdir, readdir, readFile, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { constants as osConstants, homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { execa, type ResultPromise } from "execa";
import {
  consumeEvents,
  parseJsonLine,
  type AgentEvent,
  type EventParser,
} from "./events.js";
import { ALLOWED_SHELL_COMMANDS, type AgentPermissions } from "./permissions.js";
import { buildPipedStdio, buildStdio } from "./stdio.js";
import type { Agent, AgentRunOpts, AgentRunResult } from "./types.js";

export interface KiroAgentOptions {
  model: string;
  ci?: boolean;
  /**
   * Home directory whose `.kiro/agents/` receives the temporary run profile.
   * Defaults to `os.homedir()`, which is also how kiro's v3 engine finds it.
   * Tests point it at a scratch directory.
   */
  homeDir?: string;
}

/** One rule of kiro's v3 capability-based permission model. */
export interface KiroPermissionRule {
  capability: string;
  match: string[];
  exclude?: string[];
  effect: "allow" | "deny";
}

/**
 * Marks an agent file as Saaga's temporary run profile. The stale-file
 * sweep deletes only files that carry it, so it never deletes a user's own
 * agent, even one whose name starts with `saaga-`.
 */
export const KIRO_PROFILE_MARKER = "Temporary Saaga run profile; safe to delete";

/** Prefix of the temporary agent's name and filename. */
const PROFILE_PREFIX = "saaga-";

/** The sweep deletes leftover profiles older than this. Younger ones may belong to a live run. */
const STALE_PROFILE_MS = 24 * 60 * 60 * 1000;

/**
 * Tools a restricted run must not use. Kiro drops a rule with an unknown
 * capability and only logs a warning, so these names must match its
 * capability table exactly.
 */
const DENIED_CAPABILITIES = [
  "mcp",
  "power",
  "subagent",
  "skill",
  "web_fetch",
  "web_search",
] as const;

/**
 * The messages kiro's v3 engine writes when a policy refuses a tool call.
 * The first is for an unstated action, which headless mode refuses instead
 * of asking. The second is for an explicit deny rule. Ordinary tool failures
 * carry neither.
 *
 * Both patterns match only at the start of the message, after the `Output:`
 * line kiro puts before shell results. A failed command whose output quotes
 * the phrase, such as a grep over a file that contains it, is not a refusal.
 */
const DENIAL_PATTERNS = [
  /^(?:Output:\n)?(The user rejected this tool call\.)/,
  /^(?:Output:\n)?(Tool call denied by user's permissions\.[^\n]*)/,
];

/**
 * The spinner kiro shows when it has no usable login. Even with
 * `--no-interactive`, kiro then waits for a browser login indefinitely.
 * Kiro redraws the spinner with a raw `\r` and its bar glyphs and never
 * ends the line. A stream-json line always escapes a carriage return, so an
 * agent that quotes "Opening browser" from the code it documents cannot
 * match this pattern.
 */
const LOGIN_FLOW_MARKER = /\r[▰▱]+ Opening browser/;

/** How much of the previous chunk to keep, to catch a marker split across two chunks. */
const LOGIN_FLOW_CARRY = 64;

/** Signals whose default action would end Saaga without an `exit` event. */
const TERMINATING_SIGNALS = ["SIGTERM", "SIGHUP"] as const;

export class KiroAgent implements Agent {
  readonly name = "kiro";
  private readonly model: string;
  private readonly ci: boolean;
  private readonly homeDir: string;

  constructor(opts: KiroAgentOptions) {
    this.model = opts.model;
    this.ci = opts.ci ?? false;
    this.homeDir = opts.homeDir ?? homedir();
  }

  async run(prompt: string, opts: AgentRunOpts): Promise<AgentRunResult> {
    const profile = opts.permissions
      ? await installProfile(opts.permissions, this.homeDir, opts.additionalDirs?.[0])
      : undefined;
    // `process.exit()` on a signal skips the `finally` below, and an `exit`
    // listener cannot await, so this listener deletes the profile synchronously.
    if (profile) process.once("exit", profile.removeSync);

    try {
      const args = buildKiroArgs(opts.model ?? this.model, prompt, {
        agentName: profile?.name,
        streamJson: Boolean(opts.onEvent),
      });
      return { exitCode: await spawnKiro(args, opts) };
    } finally {
      if (profile) process.removeListener("exit", profile.removeSync);
      await profile?.remove();
    }
  }
}

export interface KiroArgsOptions {
  /** The temporary agent carrying the permission profile; absent means unrestricted. */
  agentName?: string;
  streamJson: boolean;
}

/**
 * `--v3` is required because `--agent-engine` defaults to v2, which has a
 * different permission model. The model is always passed explicitly because
 * kiro's default is `auto`, which picks a model per task.
 */
export function buildKiroArgs(model: string, prompt: string, opts: KiroArgsOptions): string[] {
  return [
    "chat",
    "--no-interactive",
    "--v3",
    "--model",
    model,
    "--output-format",
    opts.streamJson ? "stream-json" : "text",
    ...(opts.agentName ? ["--agent", opts.agentName] : ["--trust-all-tools"]),
    prompt,
  ];
}

/**
 * Spawn kiro in its own process group and wait for it to exit.
 *
 * `kiro-cli` is a launcher for `kiro-cli-chat`, which does the work. A
 * signal sent to the launcher alone does not stop `kiro-cli-chat`, so
 * cancelling signals the whole group instead of using execa's
 * `cancelSignal`.
 *
 * In its own group, kiro does not receive the SIGHUP of a closed terminal,
 * and execa's exit cleanup skips detached children. So this function
 * signals the group whenever Saaga ends. That covers `exit`, and also
 * SIGTERM and SIGHUP, whose default action ends the process without an
 * `exit` event. A handler for those signals replaces the default action, so
 * the handler exits with the code the signal would have produced.
 *
 * SIGINT is handled the same way, with one difference. `saaga run` has its
 * own SIGINT handler, which cancels the run through `opts.signal` so it can
 * be resumed. The SIGINT handler here stops the group and exits only when no
 * other handler is listening, as in `saaga doctor`.
 *
 * stdout is piped in text mode too, so the login-flow guard can read it.
 * The log file and the terminal still receive the same output.
 */
async function spawnKiro(args: string[], opts: AgentRunOpts): Promise<number> {
  const stdio = opts.onEvent ? buildPipedStdio(opts) : withPipedStdout(buildStdio(opts));

  let proc: ResultPromise;
  try {
    proc = execa("kiro-cli", args, {
      cwd: opts.cwd,
      // Kiro's shell tool reports $PWD if it names the working directory,
      // and the physical path otherwise. The inherited $PWD is Saaga's own
      // directory, so without this line a symlinked workspace, such as
      // macOS `/var` pointing to `/private/var`, shows up under another path.
      env: { PWD: opts.cwd },
      reject: false,
      detached: true,
      ...stdio,
    });
  } catch {
    return 1;
  }

  const killGroup = (): void => {
    if (proc.pid === undefined) return;
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      // Already exited.
    }
  };
  const onAbort = (): void => killGroup();
  const onSignal = (signal: NodeJS.Signals): void => {
    killGroup();
    process.exit(128 + osConstants.signals[signal]);
  };
  const onInterrupt = (): void => {
    killGroup();
    // `once` has already removed this listener, so any count left is
    // another handler, which then decides whether Saaga exits.
    if (process.listenerCount("SIGINT") === 0) process.exit(128 + osConstants.signals.SIGINT);
  };
  if (opts.signal?.aborted) killGroup();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  process.once("exit", killGroup);
  for (const signal of TERMINATING_SIGNALS) process.once(signal, onSignal);
  process.once("SIGINT", onInterrupt);

  try {
    let loginRequired = false;
    const onLoginFlow = (): void => {
      loginRequired = true;
      killGroup();
    };
    const consumed = !proc.stdout
      ? Promise.resolve()
      : opts.onEvent
        ? consumeEvents(
            watchForLoginFlow(proc.stdout, onLoginFlow),
            createKiroEventParser(),
            opts.onEvent,
          )
        : drain(watchForLoginFlow(proc.stdout, onLoginFlow));

    const [result] = await Promise.all([proc, consumed]);
    if (loginRequired) {
      process.stderr.write(
        "kiro-cli is not logged in (it started a browser login): " +
          "run 'kiro-cli login' and resume the run\n",
      );
      return 1;
    }
    return result.exitCode ?? 1;
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    process.removeListener("exit", killGroup);
    for (const signal of TERMINATING_SIGNALS) process.removeListener(signal, onSignal);
    process.removeListener("SIGINT", onInterrupt);
  }
}

/** Add a pipe to plain stdio's stdout, keeping its file and terminal targets. */
export function withPipedStdout(stdio: Record<string, unknown>): Record<string, unknown> {
  const targets: unknown[] = Array.isArray(stdio.stdout) ? (stdio.stdout as unknown[]) : [stdio.stdout];
  return { ...stdio, stdout: ["pipe", ...targets] };
}

/** Read a stream to its end. Kiro blocks if nothing reads its piped stdout. */
async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _chunk of stream) {
    // Only the login-flow guard needs to see it.
  }
}

/**
 * Pass a stream through unchanged, and call `onLoginFlow` once if kiro
 * starts its browser login. This reads raw chunks instead of lines because
 * the spinner never writes a newline. It keeps the end of each chunk to
 * catch a marker split across two chunks.
 */
export async function* watchForLoginFlow<T extends string | Uint8Array>(
  stream: AsyncIterable<T>,
  onLoginFlow: () => void,
): AsyncGenerator<T> {
  const decoder = new TextDecoder();
  let carry = "";
  let seen = false;
  for await (const chunk of stream) {
    if (!seen) {
      const text = carry + (typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true }));
      if (LOGIN_FLOW_MARKER.test(text)) {
        seen = true;
        onLoginFlow();
      }
      carry = text.slice(-LOGIN_FLOW_CARRY);
    }
    yield chunk;
  }
}

interface InstalledProfile {
  name: string;
  remove: () => Promise<void>;
  /** The same cleanup, synchronous, for an `exit` listener. */
  removeSync: () => void;
}

/**
 * Write the run's permission profile as a uniquely named global kiro agent.
 *
 * Kiro's v3 engine reads agents and permission files from the real home
 * directory and ignores `KIRO_HOME`, so the profile cannot live in the run
 * directory. A global agent writes nothing into the user's repository and
 * never overwrites an existing file, and kiro applies its rules only to
 * sessions started with its name. This function also writes a copy to
 * `<runDir>/.kiro-cli/agent.json`, so the run keeps a record of what it was
 * allowed after the temporary agent is deleted.
 */
async function installProfile(
  permissions: AgentPermissions,
  homeDir: string,
  runDir: string | undefined,
): Promise<InstalledProfile> {
  const name = PROFILE_PREFIX + randomBytes(6).toString("hex");
  const content =
    JSON.stringify(
      {
        name,
        description: KIRO_PROFILE_MARKER,
        tools: ["*"],
        permissions: { rules: buildKiroPermissionRules(permissions, realPathForms) },
      },
      null,
      2,
    ) + "\n";

  // Write the record first. It touches nothing outside the run directory,
  // so a failure here leaves the user's ~/.kiro unchanged.
  if (runDir) {
    const recordDir = join(runDir, ".kiro-cli");
    await mkdir(recordDir, { recursive: true });
    await writeFile(join(recordDir, "agent.json"), content);
  }

  const agentsDir = join(homeDir, ".kiro", "agents");
  const file = join(agentsDir, `${name}.json`);
  const createdDir = !(await pathExists(agentsDir));
  const remove = async (): Promise<void> => {
    await unlink(file).catch(() => undefined);
    // Remove the directory only if Saaga created it and it is empty again.
    if (createdDir) await rmdir(agentsDir).catch(() => undefined);
  };
  const removeSync = (): void => {
    try {
      unlinkSync(file);
    } catch {
      // Already deleted.
    }
    try {
      if (createdDir) rmdirSync(agentsDir);
    } catch {
      // Not empty, or already deleted.
    }
  };

  try {
    await mkdir(agentsDir, { recursive: true });
    await sweepStaleProfiles(agentsDir);
    await writeFile(file, content, { flag: "wx" });
  } catch (err) {
    // The caller's `finally` only removes a profile that installed, so clean up here.
    await remove();
    throw err;
  }
  return { name, remove, removeSync };
}

/**
 * Delete temporary profiles that a killed run left behind. A file is deleted
 * only if it has Saaga's name prefix and marker, and is older than any live
 * run could be.
 */
export async function sweepStaleProfiles(agentsDir: string, now = Date.now()): Promise<void> {
  let names: string[];
  try {
    names = await readdir(agentsDir);
  } catch {
    return;
  }
  for (const entry of names) {
    if (!/^saaga-[0-9a-f]+\.json$/.test(entry)) continue;
    const file = join(agentsDir, entry);
    try {
      const info = await stat(file);
      if (now - info.mtimeMs < STALE_PROFILE_MS) continue;
      const parsed = JSON.parse(await readFile(file, "utf8")) as { description?: unknown };
      if (parsed.description !== KIRO_PROFILE_MARKER) continue;
      await unlink(file);
    } catch {
      // Skip a file that cannot be read or was already deleted.
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Translate a permission profile into kiro rules.
 *
 * In kiro a deny rule beats an allow rule in every scope, and kiro always
 * merges in the user's own `~/.kiro/settings/permissions.yaml`. With allow
 * rules alone, a broad allow in that file would widen the run. Three deny
 * rules prevent that. They deny every read outside the read roots, every
 * write outside the write roots, and every command except the allowed ones.
 *
 * Each of those denies uses `exclude`. Kiro's docs warn that an `fs_read`
 * deny disables every read tool, and that is true of a deny without
 * `exclude`. With the read roots excluded, reading, listing and searching
 * inside them still work (verified against kiro-cli 2.22.0).
 *
 * Kiro matches absolute paths in their real form (`/private/tmp`, not
 * `/tmp`), so this function emits every path in each form `realPath`
 * returns.
 */
export function buildKiroPermissionRules(
  permissions: AgentPermissions,
  realPath: (path: string) => string[] = (path) => [path],
): KiroPermissionRule[] {
  const pathPatterns = (paths: readonly string[]): string[] => [
    ...new Set(
      paths.flatMap((path) =>
        realPath(path).flatMap((form) => (form.endsWith("*") ? [form] : [form, subtree(form)])),
      ),
    ),
  ];

  const readRoots = pathPatterns(permissions.readRoots);
  const writeRoots = pathPatterns(permissions.writeRoots);
  const rules: KiroPermissionRule[] = [
    { capability: "fs_read", match: readRoots, effect: "allow" },
    { capability: "fs_read", match: ["**"], exclude: readRoots, effect: "deny" },
    { capability: "fs_write", match: writeRoots, effect: "allow" },
    { capability: "fs_write", match: ["**"], exclude: writeRoots, effect: "deny" },
  ];
  if (permissions.denyPaths.length > 0) {
    rules.push({
      capability: "fs_write",
      match: pathPatterns(permissions.denyPaths),
      effect: "deny",
    });
  }

  if (permissions.shell === "restricted") {
    const allowed = [
      ...ALLOWED_SHELL_COMMANDS.utilities.flatMap((cmd) => [cmd, `${cmd} *`]),
      // Match on the subcommand, so `git -c core.pager=… log` does not match.
      ...ALLOWED_SHELL_COMMANDS.git.flatMap((sub) => [`git ${sub}`, `git ${sub} *`]),
    ];
    rules.push(
      { capability: "shell", match: allowed, effect: "allow" },
      { capability: "shell", match: ["*"], exclude: allowed, effect: "deny" },
    );
  } else {
    rules.push({ capability: "shell", match: ["*"], effect: "deny" });
  }

  for (const capability of DENIED_CAPABILITIES) {
    rules.push({ capability, match: ["*"], effect: "deny" });
  }
  return rules;
}

/** The glob for everything under `path`. The root's subtree is `/**`, not `//**`. */
function subtree(path: string): string {
  return path === "/" ? "/**" : `${path}/**`;
}

/**
 * Return the given path, plus its real-path form if a symlink changes it.
 * This resolves the part before any glob segment through its nearest
 * existing ancestor, so it also works for paths that do not exist yet.
 */
export function realPathForms(path: string): string[] {
  const segments = path.split("/");
  const globAt = segments.findIndex((segment) => /[*?[{]/.test(segment));
  const literal = globAt === -1 ? path : segments.slice(0, globAt).join("/");
  const rest = globAt === -1 ? "" : "/" + segments.slice(globAt).join("/");

  let existing = literal;
  let tail = "";
  for (;;) {
    try {
      const real = realpathSync(existing) + tail + rest;
      return real === path ? [path] : [path, real];
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return [path];
      tail = "/" + basename(existing) + tail;
      existing = parent;
    }
  }
}

interface KiroToolCall {
  title?: string;
  kind?: string;
  path?: string;
  command?: string;
}

/**
 * Parse kiro's `stream-json` output. Each line is one `{type, data}` record
 * that carries an Agent Client Protocol session update.
 *
 * A refusal is a `tool_call_update` with `status: "failed"` whose message
 * matches `DENIAL_PATTERNS`. The update that fails a call may omit its
 * target, so the parser remembers each call by `toolCallId` from its first
 * record. Kiro reports usage in credits, not tokens or dollars, and does not
 * announce its tools, so the parser emits no usage or session events.
 */
export function createKiroEventParser(): EventParser {
  const calls = new Map<string, KiroToolCall>();

  return {
    push(line: string): AgentEvent[] {
      const obj = parseJsonLine(line);
      if (!obj || obj.type !== "sessionUpdate") return [];
      const update = (obj.data as { update?: Record<string, unknown> } | undefined)?.update;
      const kind = update?.sessionUpdate;
      if (!update || (kind !== "tool_call" && kind !== "tool_call_update")) return [];

      const id = typeof update.toolCallId === "string" ? update.toolCallId : undefined;
      const call = mergeToolCall(id ? calls.get(id) : undefined, update);
      if (id) calls.set(id, call);
      if (update.status !== "failed") return [];

      if (id) calls.delete(id);
      const message = denialMessage(update);
      if (!message) return [];
      return [
        {
          kind: "denial",
          tool: call.title ?? call.kind ?? "unknown",
          path: call.path,
          command: call.command,
          message,
        },
      ];
    },
  };
}

function mergeToolCall(
  previous: KiroToolCall | undefined,
  update: Record<string, unknown>,
): KiroToolCall {
  const locations = update.locations as Array<{ path?: unknown }> | undefined;
  const rawInput = update.rawInput as { path?: unknown; command?: unknown } | undefined;
  const str = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;
  return {
    title: str(update.title) ?? previous?.title,
    kind: str(update.kind) ?? previous?.kind,
    path: str(locations?.[0]?.path) ?? str(rawInput?.path) ?? previous?.path,
    command: str(rawInput?.command) ?? previous?.command,
  };
}

/** The refusal text from a failed update, or undefined for an ordinary failure. */
function denialMessage(update: Record<string, unknown>): string | undefined {
  const texts: string[] = [];
  const rawOutput = update.rawOutput as { message?: unknown } | undefined;
  if (typeof rawOutput?.message === "string") texts.push(rawOutput.message);
  for (const item of (update.content as Array<{ content?: { text?: unknown } }> | undefined) ?? []) {
    if (typeof item?.content?.text === "string") texts.push(item.content.text);
  }
  for (const text of texts) {
    for (const pattern of DENIAL_PATTERNS) {
      const match = pattern.exec(text);
      if (match) return match[1];
    }
  }
  return undefined;
}
