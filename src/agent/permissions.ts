import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface AgentPermissions {
  readRoots: string[];
  writeRoots: string[];
  denyPaths: string[];
  shell: "none" | "read-only-git";
}

/**
 * Git subcommands allowed under the "read-only-git" shell policy.
 *
 * Subcommand anchoring defeats `git -c core.pager='sh -c …' log` since
 * that command starts with `git -c`, not a listed subcommand.
 *
 * Only cursor can honour this policy. Copilot and claude both have to remove
 * the shell wholesale to block arbitrary commands, so they degrade to no
 * shell at all rather than granting these.
 */
export const READ_ONLY_GIT: readonly string[] = [
  "log",
  "show",
  "diff",
  "blame",
  "status",
  "ls-files",
  "cat-file",
  "rev-parse",
];

export interface BuildProfileInput {
  appPath: string;
  docsDir: string;
  runDir: string;
  allowDirs?: string[];
}

/**
 * Build the default restricted permission profile for an agent run.
 *
 * The profile grants:
 * - Read: entire app tree (run dir is inside the app tree)
 * - Write: `<app>/<docsDir>/**` and the run directory
 * - Deny: rule files, BASELINE
 * - Shell: read-only git subcommands only
 *
 * When `allowDirs` are given (from `--allow-dir`), they are appended to both
 * readRoots and writeRoots.
 */
export function buildProfile(input: BuildProfileInput): AgentPermissions {
  const { appPath, docsDir, runDir } = input;
  const docsPath = resolve(appPath, docsDir);

  const readRoots = [appPath];
  const writeRoots = [docsPath, runDir];

  for (const dir of input.allowDirs ?? []) {
    const resolved = resolve(dir);
    readRoots.push(resolved);
    writeRoots.push(resolved);
  }

  const denyPaths = [
    resolve(appPath, "AGENTS.md"),
    resolve(appPath, "CLAUDE.md"),
    resolve(appPath, ".cursor/rules/**"),
    resolve(appPath, ".github/instructions/**"),
    resolve(docsPath, "BASELINE"),
  ];

  return {
    readRoots,
    writeRoots,
    denyPaths,
    shell: "read-only-git",
  };
}

/**
 * List every filesystem entry that must be denied so that only `keepPaths`
 * and their descendants stay reachable.
 *
 * Walks the ancestor chain of each keep path and enumerates the siblings at
 * each level, so `/etc`, `/home`, and neighbouring projects all end up in the
 * result while the branch leading to the workspace does not.
 *
 * Needed by backends that honour deny rules but not allow rules, where a
 * broad default cannot be narrowed and has to be carved out instead.
 */
export async function enumerateExcludedPaths(
  keepPaths: string[],
): Promise<string[]> {
  const keep = new Set(keepPaths.map((p) => resolve(p)));

  const onPath = new Set<string>();
  for (const target of keep) {
    for (let cur = target; ; cur = dirname(cur)) {
      onPath.add(cur);
      if (dirname(cur) === cur) break;
    }
  }

  const excluded: string[] = [];
  for (const dir of onPath) {
    if (keep.has(dir)) continue;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (!onPath.has(full)) excluded.push(full);
    }
  }
  return excluded;
}
