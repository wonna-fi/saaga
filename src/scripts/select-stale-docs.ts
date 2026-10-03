import { mkdir, readFile, writeFile } from "node:fs/promises";
import { posix, resolve } from "node:path";
import { execa } from "execa";
import ignore, { type Ignore } from "ignore";
import { parseDoc } from "../docs/frontmatter.js";
import { listDocFiles } from "../docs/link-graph.js";
import { NonResumableError } from "../engine/errors.js";
import type { ScriptContext } from "./registry.js";

export interface SelectStaleDocsArgs {
  /** Absolute path to the application directory. */
  app_dir: string;
  /** Name of the documentation directory, relative to `app_dir`. */
  docs_dir: string;
  /** Run directory the selection report is written into. */
  output_dir: string;
}

export interface SelectStaleDocsResult {
  /** Number of documents selected for verification. */
  count: number;
  /** Absolute path to the `stale-docs.md` report. */
  report_path: string;
}

/** Why a document was selected. */
export type StaleReason =
  | "no-frontmatter"
  | "never-verified"
  | "no-sources"
  | "sources-changed";

export interface StaleDoc {
  /** Path relative to the application directory. */
  path: string;
  reason: StaleReason;
  last_verified?: string;
  /** For `sources-changed`: the changed paths its `sources` cover. */
  changed?: string[];
}

/** Changed paths listed per document before the report truncates. */
const MAX_LISTED_CHANGES = 20;

/** Generated navigation at the docs root: never verified, never selected. */
const GENERATED_ROOT_FILES = new Set(["README.md", "GLOSSARY.md"]);

/**
 * Selects every document whose covered sources changed since it was last
 * verified, regardless of which slice last touched it.
 *
 * Change is read from git history, not from `BASELINE`: every update-family
 * flow advances the baseline, so by the time a sweep runs the change that
 * made a document stale is usually no longer in the diff. Git is the one
 * record of change every way of running Saaga shares. Without usable history
 * the selection would be a guess, so the script refuses before any agent runs.
 *
 * A document is selected when it has no frontmatter, no `last_verified` (the
 * verification-pending marker), no `sources` (nothing to compare against —
 * except a convention, which never declares any), or when a path changed on
 * or after its `last_verified` date matches one of its `sources` entries.
 */
export async function selectStaleDocs(
  args: SelectStaleDocsArgs,
  ctx: ScriptContext,
): Promise<SelectStaleDocsResult> {
  if (!args.app_dir) {
    throw new Error("select-stale-docs: 'app_dir' arg is required");
  }
  if (!args.docs_dir) {
    throw new Error("select-stale-docs: 'docs_dir' arg is required");
  }
  if (!args.output_dir) {
    throw new Error("select-stale-docs: 'output_dir' arg is required");
  }

  const appDir = args.app_dir;
  const docsDir = posix.normalize(args.docs_dir.replace(/\\/g, "/")).replace(/\/+$/, "");
  await requireGitHistory(appDir);

  const docsRoot = resolve(appDir, docsDir);
  const changesSince = new Map<string, Promise<string[]>>();
  const selected: StaleDoc[] = [];

  for (const rel of await listDocFiles(docsRoot)) {
    if (posix.basename(rel) === "INDEX.md" || GENERATED_ROOT_FILES.has(rel)) {
      continue;
    }
    const path = posix.join(docsDir, rel);
    const { frontmatter } = parseDoc(await readFile(resolve(docsRoot, rel), "utf8"));

    if (frontmatter === null) {
      selected.push({ path, reason: "no-frontmatter" });
      continue;
    }
    if (frontmatter.type === "index") continue;

    const lastVerified = frontmatter.last_verified;
    if (!lastVerified) {
      selected.push({ path, reason: "never-verified" });
      continue;
    }
    const sources = frontmatter.sources ?? [];
    if (sources.length === 0) {
      // A convention states a rule the codebase holds itself to, not a claim
      // about a file, so it carries no sources by design and no source change
      // can make it stale.
      if (frontmatter.type !== "convention") {
        selected.push({ path, reason: "no-sources", last_verified: lastVerified });
      }
      continue;
    }

    let pending = changesSince.get(lastVerified);
    if (!pending) {
      pending = changedPathsSince(appDir, docsDir, lastVerified);
      changesSince.set(lastVerified, pending);
    }
    const matcher = sourcesMatcher(sources);
    const changed = (await pending).filter((p) => matcher.ignores(p));
    if (changed.length > 0) {
      selected.push({ path, reason: "sources-changed", last_verified: lastVerified, changed });
    }
  }

  await mkdir(args.output_dir, { recursive: true });
  const reportPath = resolve(args.output_dir, "stale-docs.md");
  await writeFile(reportPath, renderReport(selected), "utf8");

  if (selected.length > 0) {
    ctx.warn?.(`select-stale-docs: ${selected.length} stale document(s) (${summarizeReasons(selected)})`);
  }

  return { count: selected.length, report_path: reportPath };
}

/**
 * Throws unless `appDir` is inside a git work tree with a commit and full
 * history. A shallow clone is refused because its history stops at the
 * clone depth: changes older than that would silently go unseen.
 */
async function requireGitHistory(appDir: string): Promise<void> {
  const inside = await git(appDir, ["rev-parse", "--is-inside-work-tree"]);
  if (inside === null || inside.trim() !== "true") {
    throw new NonResumableError(
      `select-stale-docs: ${appDir} is not a git repository; the sweep needs git history to tell which documents' sources changed since they were last verified`,
    );
  }
  if ((await git(appDir, ["rev-parse", "--verify", "--quiet", "HEAD"])) === null) {
    throw new NonResumableError(
      "select-stale-docs: the repository has no commits; the sweep needs git history to tell which documents' sources changed since they were last verified",
    );
  }
  const shallow = await git(appDir, ["rev-parse", "--is-shallow-repository"]);
  if (shallow?.trim() === "true") {
    throw new NonResumableError(
      "select-stale-docs: the repository is a shallow clone, so changes older than the clone depth are invisible; fetch the full history (`git fetch --unshallow`, or `fetch-depth: 0` in actions/checkout) and run again",
    );
  }
}

/**
 * Every path under `appDir` changed on or after `date` — committed, staged,
 * modified or untracked — relative to `appDir`, with the docs directory and
 * run directories removed. Renames are listed as both their old and new path:
 * a document covering the old name is exactly the one a rename makes stale.
 *
 * `date` is the local calendar day a verification stamped, and the whole day
 * counts: a same-day commit re-selects a document verified that day. Selecting
 * one document too many costs a verification; one too few is the bug.
 */
async function changedPathsSince(
  appDir: string,
  docsDir: string,
  date: string,
): Promise<string[]> {
  const outputs = await Promise.all([
    gitOrThrow(appDir, [
      "log", `--since=${date}T00:00:00`, "--no-renames", "--name-only",
      "--format=", "--relative", "--", ".",
    ]),
    gitOrThrow(appDir, ["diff", "--name-only", "--no-renames", "--relative", "HEAD", "--", "."]),
    gitOrThrow(appDir, ["ls-files", "--others", "--exclude-standard", "--", "."]),
  ]);

  const docsPrefix = `${docsDir}/`;
  const paths = new Set<string>();
  for (const output of outputs) {
    for (const line of output.split("\n")) {
      const path = line.trim();
      if (!path || path.startsWith(docsPrefix) || path.startsWith(".saaga-runs/")) continue;
      paths.add(path);
    }
  }
  return [...paths].sort();
}

/**
 * A gitignore-semantics matcher over a document's `sources`: a directory
 * entry covers everything under it, globs work, a file path matches itself.
 */
function sourcesMatcher(sources: string[]): Ignore {
  const patterns = sources
    .map((s) => s.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, ""))
    .filter((s) => s.length > 0);
  return ignore().add(patterns);
}

function renderReport(docs: StaleDoc[]): string {
  const lines = [
    "# Stale Documents",
    "",
    `**Selected**: ${docs.length}${docs.length > 0 ? ` (${summarizeReasons(docs)})` : ""}`,
    "",
    "Paths are relative to the application directory. Reasons:",
    "",
    "- `sources-changed` — a path its `sources` cover changed on or after its `last_verified` date",
    "- `never-verified` — no `last_verified` stamp: never verified, or its last verification recorded findings",
    "- `no-sources` — no `sources` list, so whether it is stale cannot be decided (conventions never carry one and are not selected for it)",
    "- `no-frontmatter` — no frontmatter block at all",
    "",
  ];
  for (const doc of docs) {
    lines.push(`## ${doc.path}`, "");
    lines.push(`- **Reason**: \`${doc.reason}\``);
    lines.push(`- **Last verified**: ${doc.last_verified ?? "—"}`);
    if (doc.changed) {
      lines.push("- **Changed sources**:");
      for (const path of doc.changed.slice(0, MAX_LISTED_CHANGES)) {
        lines.push(`  - \`${path}\``);
      }
      if (doc.changed.length > MAX_LISTED_CHANGES) {
        lines.push(`  - +${doc.changed.length - MAX_LISTED_CHANGES} more`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function summarizeReasons(docs: StaleDoc[]): string {
  const counts = new Map<StaleReason, number>();
  for (const doc of docs) counts.set(doc.reason, (counts.get(doc.reason) ?? 0) + 1);
  return [...counts].map(([reason, n]) => `${n} ${reason}`).join(", ");
}

/** Runs git in `cwd`; `null` when it exits non-zero or cannot be spawned. */
async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execa("git", ["-c", "core.quotePath=false", ...args], { cwd });
    return stdout;
  } catch {
    return null;
  }
}

async function gitOrThrow(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execa("git", ["-c", "core.quotePath=false", ...args], { cwd });
    return stdout;
  } catch (err) {
    throw new Error(
      `select-stale-docs: 'git ${args[0]}' failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}
