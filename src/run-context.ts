import { randomBytes } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

export interface CreateRunContextInput {
  /** Display name for the application (used as the run-id prefix). */
  app: string;
  /** Subcommand label embedded in the run-id (e.g. `init`, `update`, `slice-1`). */
  subcommand: string;
  /** Absolute path to the application directory. */
  appPath: string;
  /** Override the timestamp portion of the id (used by tests). */
  now?: Date;
}

export interface RunContext {
  app: string;
  appPath: string;
  subcommand: string;
  runId: string;
  runDir: string;
  /** Date portion of the run timestamp, formatted as YYYYMMDD. */
  date: string;
  /**
   * The same date as an ISO calendar date (YYYY-MM-DD). Document frontmatter
   * stores dates in this form, so `date`'s run-id formatting cannot be reused
   * there.
   */
  isoDate: string;
}

/**
 * Generates a unique run identifier and creates the corresponding run dir
 * on disk at `<appPath>/.saaga-runs/<run-id>`.
 *
 * The id format mirrors `run.sh::generate_run_id()`:
 *   `<app>-<subcommand>-<YYYYMMDD>-<HHMMSS>-<8 hex chars>`
 */
export async function createRunContext(
  input: CreateRunContextInput,
): Promise<RunContext> {
  const now = input.now ?? new Date();
  const stamp = formatTimestamp(now);
  const random = randomBytes(4).toString("hex");
  const runId = `${input.app}-${input.subcommand}-${stamp}-${random}`;

  const runDir = resolve(input.appPath, ".saaga-runs", runId);
  await mkdir(runDir, { recursive: true });

  return {
    app: input.app,
    appPath: input.appPath,
    subcommand: input.subcommand,
    runId,
    runDir,
    date: formatDate(now),
    isoDate: formatIsoDate(now),
  };
}

/**
 * Rebuilds the context of an earlier run from its manifest, so a resumed
 * run keeps the same id, directory and dates. The run-id string is never
 * parsed: app names may contain dashes.
 */
export async function reopenRunContext(input: {
  app: string;
  appPath: string;
  subcommand: string;
  runId: string;
  date: string;
  isoDate: string;
}): Promise<RunContext> {
  const runDir = resolve(input.appPath, ".saaga-runs", input.runId);
  let isDir: boolean;
  try {
    isDir = (await stat(runDir)).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    throw new Error(`run directory not found: ${runDir}`);
  }
  return {
    app: input.app,
    appPath: input.appPath,
    subcommand: input.subcommand,
    runId: input.runId,
    runDir,
    date: input.date,
    isoDate: input.isoDate,
  };
}

function formatTimestamp(date: Date): string {
  const yyyy = date.getFullYear().toString().padStart(4, "0");
  const mm = (date.getMonth() + 1).toString().padStart(2, "0");
  const dd = date.getDate().toString().padStart(2, "0");
  const hh = date.getHours().toString().padStart(2, "0");
  const mi = date.getMinutes().toString().padStart(2, "0");
  const ss = date.getSeconds().toString().padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function formatDate(date: Date): string {
  const yyyy = date.getFullYear().toString().padStart(4, "0");
  const mm = (date.getMonth() + 1).toString().padStart(2, "0");
  const dd = date.getDate().toString().padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function formatIsoDate(date: Date): string {
  const yyyy = date.getFullYear().toString().padStart(4, "0");
  const mm = (date.getMonth() + 1).toString().padStart(2, "0");
  const dd = date.getDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
