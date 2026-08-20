import { appendFile } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import type { AgentEvent, DenialEvent } from "./events.js";
import type { AgentPermissions } from "./permissions.js";

/**
 * What a refused tool call means, judged against the profile we asked for.
 *
 * The useful distinction is not how the backend worded the refusal but which
 * path it refused, so every class here is decided by comparing that path to
 * the roots in the profile.
 */
export type DenialClass =
  /** Refused inside a root we intended to grant — our profile is wrong. */
  | "unexpected"
  /** Wanted something outside the workspace; `--allow-dir` would fix it. */
  | "out-of-workspace"
  /** Refused a path we deliberately withheld. Working as intended. */
  | "protected-path"
  /** A command rather than a path. */
  | "shell"
  /** No path recovered, so it cannot be placed. */
  | "unknown";

export interface ClassifiedDenial {
  event: DenialEvent;
  className: DenialClass;
  /** Absolute form of `event.path`, when one could be determined. */
  resolvedPath?: string;
}

const SHELL_TOOLS = new Set(["bash", "shell", "terminal", "run_terminal_cmd"]);

function isInside(path: string, root: string): boolean {
  return path === root || path.startsWith(root + sep);
}

/**
 * Place a denial against the profile.
 *
 * `cwd` is needed because copilot reports relative paths.
 */
export function classifyDenial(
  event: DenialEvent,
  perms: AgentPermissions,
  cwd: string,
): ClassifiedDenial {
  if (SHELL_TOOLS.has(event.tool.toLowerCase())) {
    return { event, className: "shell" };
  }
  if (!event.path) {
    return { event, className: "unknown" };
  }

  const resolvedPath = isAbsolute(event.path) ? event.path : resolve(cwd, event.path);

  // An explicit deny is the most specific statement in the profile, so it
  // wins over the roots even though the path also sits inside one of them.
  const denied = perms.denyPaths.some((p) => {
    const bare = p.replace(/\/?\*+$/, "");
    return resolvedPath === bare || isInside(resolvedPath, bare);
  });
  if (denied) return { event, className: "protected-path", resolvedPath };

  if (perms.writeRoots.some((root) => isInside(resolvedPath, root))) {
    return { event, className: "unexpected", resolvedPath };
  }
  if (perms.readRoots.some((root) => isInside(resolvedPath, root))) {
    // Readable but deliberately not writable, which is the common case for
    // source files. A refused *read* here would be a profile bug, but the
    // backends do not distinguish the two in their denial events.
    return { event, className: "protected-path", resolvedPath };
  }
  return { event, className: "out-of-workspace", resolvedPath };
}

const CLASS_NOTES: Record<DenialClass, string> = {
  unexpected:
    "Refused inside a directory the profile grants. This is a saaga bug or backend drift; the run is silently degraded.",
  "out-of-workspace":
    "The agent wanted a path outside the workspace. Pass --allow-dir <path> if it genuinely needs it.",
  "protected-path": "Refused a path the profile deliberately withholds.",
  shell: "Refused a command. Expected under every backend profile.",
  unknown: "The backend did not report which path was refused.",
};

export interface AuditResult {
  logPath: string;
  counts: Record<DenialClass, number>;
  /** Denials that indicate a broken profile rather than a working one. */
  unexpected: ClassifiedDenial[];
}

/**
 * Collects denial events over a run and writes a classified summary.
 *
 * Entries are grouped by class rather than logged in order, because the
 * volume is lopsided: refused shell probes and protected-path writes are
 * routine and numerous, while the one entry worth acting on may appear once.
 */
export class PermissionAuditor {
  private readonly entries: ClassifiedDenial[] = [];

  constructor(
    private readonly perms: AgentPermissions,
    private readonly cwd: string,
    private readonly logPath: string,
  ) {}

  record(event: AgentEvent): void {
    if (event.kind !== "denial") return;
    this.entries.push(classifyDenial(event, this.perms, this.cwd));
  }

  get unexpected(): ClassifiedDenial[] {
    return this.entries.filter((e) => e.className === "unexpected");
  }

  async flush(): Promise<AuditResult> {
    const counts = emptyCounts();
    for (const entry of this.entries) counts[entry.className]++;

    const lines: string[] = ["=== Permission audit ==="];
    for (const className of Object.keys(counts) as DenialClass[]) {
      const group = this.entries.filter((e) => e.className === className);
      if (group.length === 0) continue;
      lines.push("", `## ${className} (${group.length})`, CLASS_NOTES[className]);
      const targets = [...groupByTarget(group).values()];
      for (const [index, occurrences] of targets.entries()) {
        const first = occurrences[0];
        const repeat = occurrences.length > 1 ? `  (x${occurrences.length})` : "";
        if (index > 0) lines.push("");
        lines.push(
          `  ${first.event.tool}  ${describeTarget(first)}${repeat}`,
          `    ${summarize(first.event.message)}`,
        );
      }
    }

    const total = this.entries.length;
    lines.push("", "--- Summary ---", `Total denials: ${total}`);
    for (const className of Object.keys(counts) as DenialClass[]) {
      lines.push(`  ${className}: ${counts[className]}`);
    }
    lines.push("");

    await appendFile(this.logPath, lines.join("\n"));
    return { logPath: this.logPath, counts, unexpected: this.unexpected };
  }
}

/**
 * What an entry is filed under: the command for a refused shell call, the
 * resolved path for everything else. Only shell tools report a command, so one
 * expression covers both.
 */
function targetOf(entry: ClassifiedDenial): string | undefined {
  return entry.event.command ?? entry.resolvedPath;
}

/** The target as it is written into the log, saying which half is missing. */
function describeTarget(entry: ClassifiedDenial): string {
  const target = targetOf(entry);
  if (entry.className === "shell") {
    return target ? flattenCommand(target) : "(no command reported)";
  }
  return target ?? "(no path reported)";
}

/**
 * Fold repeats of the same tool and target into one entry.
 *
 * An agent that keeps retrying the same refused write would otherwise repeat
 * an identical block often enough to bury everything else. Shell calls report
 * no path, so they fold by command instead: two different refused commands are
 * two different findings, not one retried twice. The key uses the raw command
 * rather than the shortened form, so two long commands that happen to share a
 * prefix stay apart.
 */
function groupByTarget(entries: ClassifiedDenial[]): Map<string, ClassifiedDenial[]> {
  const groups = new Map<string, ClassifiedDenial[]>();
  for (const entry of entries) {
    const key = `${entry.event.tool}\u0000${targetOf(entry) ?? ""}`;
    const existing = groups.get(key);
    if (existing) existing.push(entry);
    else groups.set(key, [entry]);
  }
  return groups;
}

const MAX_MESSAGE = 200;

/**
 * Reduce a CLI message to its first sentence.
 *
 * Claude appends several hundred characters of guidance to every refusal,
 * which is addressed to the model rather than to whoever reads this log.
 */
function summarize(message: string): string {
  const firstLine = message.split("\n")[0].trim();
  const sentenceEnd = firstLine.indexOf(". ");
  if (sentenceEnd > 0 && sentenceEnd < MAX_MESSAGE) {
    return firstLine.slice(0, sentenceEnd + 1);
  }
  return firstLine.length > MAX_MESSAGE
    ? firstLine.slice(0, MAX_MESSAGE) + "…"
    : firstLine;
}

const MAX_COMMAND = 200;

/**
 * Fit a command onto the single line an entry gets.
 *
 * Commands reach us with heredocs and line continuations intact, and a raw
 * newline here would read as the start of a separate entry.
 */
function flattenCommand(command: string): string {
  const flat = command.replace(/\s+/g, " ").trim();
  return flat.length > MAX_COMMAND ? flat.slice(0, MAX_COMMAND) + "…" : flat;
}

function emptyCounts(): Record<DenialClass, number> {
  return {
    unexpected: 0,
    "out-of-workspace": 0,
    "protected-path": 0,
    shell: 0,
    unknown: 0,
  };
}
