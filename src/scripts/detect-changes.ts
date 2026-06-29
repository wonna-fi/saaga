import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { ScriptContext } from "./registry.js";
import { computeManifest, fileExists } from "./file-manifest.js";

export interface DetectChangesArgs {
  /** Absolute path to the application directory. */
  app_dir: string;
  /**
   * Directory where the changes report is written. The report path is
   * `<output_dir>/changes.md`. Required.
   */
  output_dir: string;
  /** Name of the documentation directory (e.g. `"saaga-docs"`). */
  docs_dir: string;
}

export interface DetectChangesResult {
  /** Total number of detected changes (zero if docs are up to date). */
  count: number;
  /** Absolute path to the markdown changes report. */
  changes_path: string;
  /** Per-classification counts (sum equals `count`). */
  changed: number;
  new: number;
  truly_deleted: number;
  newly_ignored: number;
}

/**
 * Compares the current state of the work tree against
 * `<app_dir>/<docs_dir>/BASELINE` and classifies every difference into
 * one of: changed, new, truly deleted, newly ignored.
 *
 * Writes a markdown report to `<output_dir>/changes.md` and returns the
 * detected counts so the flow engine can early-exit via
 * `if: ${changes.count} == 0`.
 */
export async function detectChanges(
  args: DetectChangesArgs,
  _ctx: ScriptContext,
): Promise<DetectChangesResult> {
  const appDir = args.app_dir;
  if (!appDir) {
    throw new Error("detect-changes: 'app_dir' arg is required");
  }
  const outputDir = args.output_dir;
  if (!outputDir) {
    throw new Error("detect-changes: 'output_dir' arg is required");
  }
  const docsDir = args.docs_dir;
  if (!docsDir) {
    throw new Error("detect-changes: 'docs_dir' arg is required");
  }
  if (!(await isDir(appDir))) {
    throw new Error(`detect-changes: directory not found: ${appDir}`);
  }
  const baselinePath = resolve(appDir, docsDir, "BASELINE");
  if (!(await isFile(baselinePath))) {
    throw new Error(
      `detect-changes: BASELINE file not found at ${baselinePath}. ` +
        "Run 'init' first to create initial documentation and baseline.",
    );
  }

  const baselineContent = await readFile(baselinePath, "utf8");
  const baselineDate = extractHeaderValue(baselineContent, "Generated");
  const baselineEntries = parseBaselineBody(baselineContent);
  const currentEntries = await computeManifest(appDir, docsDir);

  const baselineMap = new Map(baselineEntries.map((e) => [e.path, e.hash]));
  const currentMap = new Map(currentEntries.map((e) => [e.path, e.hash]));

  const newPaths: string[] = [];
  const changedPaths: string[] = [];
  for (const [path, hash] of currentMap) {
    const oldHash = baselineMap.get(path);
    if (oldHash === undefined) {
      newPaths.push(path);
    } else if (oldHash !== hash) {
      changedPaths.push(path);
    }
  }

  const deletedPaths: string[] = [];
  for (const path of baselineMap.keys()) {
    if (!currentMap.has(path)) {
      deletedPaths.push(path);
    }
  }

  newPaths.sort();
  changedPaths.sort();
  deletedPaths.sort();

  const trulyDeleted: string[] = [];
  const newlyIgnored: string[] = [];
  for (const path of deletedPaths) {
    if (await fileExists(resolve(appDir, path))) {
      newlyIgnored.push(path);
    } else {
      trulyDeleted.push(path);
    }
  }

  const counts = {
    changed: changedPaths.length,
    new: newPaths.length,
    truly_deleted: trulyDeleted.length,
    newly_ignored: newlyIgnored.length,
  };
  const total =
    counts.changed + counts.new + counts.truly_deleted + counts.newly_ignored;

  await mkdir(outputDir, { recursive: true });
  const changesPath = resolve(outputDir, "changes.md");
  const report = renderReport({
    appName: basename(appDir),
    baselineDate: baselineDate ?? "unknown",
    counts,
    changedPaths,
    newPaths,
    trulyDeleted,
    newlyIgnored,
  });
  await writeFile(changesPath, report, "utf8");

  return {
    count: total,
    changes_path: changesPath,
    ...counts,
  };
}

interface RenderInput {
  appName: string;
  baselineDate: string;
  counts: {
    changed: number;
    new: number;
    truly_deleted: number;
    newly_ignored: number;
  };
  changedPaths: string[];
  newPaths: string[];
  trulyDeleted: string[];
  newlyIgnored: string[];
}

function renderReport(input: RenderInput): string {
  const summary =
    `${input.counts.changed} changed, ${input.counts.new} new, ` +
    `${input.counts.truly_deleted} deleted, ${input.counts.newly_ignored} ignored`;

  const section = (title: string, paths: string[]): string => {
    const body =
      paths.length === 0
        ? "_None_"
        : paths.map((p) => `- \`${p}\``).join("\n");
    return `## ${title}\n\n${body}`;
  };

  return [
    "# Changes Since BASELINE",
    "",
    `**App**: ${input.appName}`,
    `**BASELINE date**: ${input.baselineDate}`,
    `**Summary**: ${summary}`,
    "",
    section("Changed Files", input.changedPaths),
    "",
    section("New Files", input.newPaths),
    "",
    section("Deleted Files", input.trulyDeleted),
    "",
    section("Newly Ignored Files", input.newlyIgnored),
    "",
  ].join("\n");
}

function extractHeaderValue(content: string, key: string): string | null {
  const re = new RegExp(`^# ${key}: (.*)$`, "m");
  const match = re.exec(content);
  return match ? match[1].trim() : null;
}

interface FileEntry {
  hash: string;
  path: string;
}

function parseBaselineBody(content: string): FileEntry[] {
  const entries: FileEntry[] = [];
  for (const line of content.split("\n")) {
    if (line.length === 0) continue;
    if (line.startsWith("#")) continue;
    const space = line.indexOf(" ");
    if (space === -1) continue;
    const hash = line.slice(0, space);
    const path = line.slice(space + 1);
    entries.push({ hash, path });
  }
  return entries;
}

async function isFile(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}
