import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export interface CreateRunContextInput {
  /** Display name for the application (used as the run-id prefix). */
  app: string;
  /** Subcommand label embedded in the run-id (e.g. `init`, `update`, `slice-1`). */
  subcommand: string;
  /** Absolute path to the application directory; surfaced as `${app_path}`. */
  appPath?: string;
  /** Process env (defaults to `process.env`); used to read HOME and SAAGA_DIR. */
  env?: NodeJS.ProcessEnv;
  /** Override the timestamp portion of the id (used by tests). */
  now?: Date;
}

export interface RunContext {
  app: string;
  appPath?: string;
  subcommand: string;
  runId: string;
  runDir: string;
  /** Date portion of the run timestamp, formatted as YYYYMMDD. */
  date: string;
}

/**
 * Generates a unique run identifier and creates the corresponding run dir
 * on disk. The dir defaults to `$HOME/.saaga/runs/<run-id>` and can be
 * relocated via `SAAGA_DIR`.
 *
 * The id format mirrors `run.sh::generate_run_id()`:
 *   `<app>-<subcommand>-<YYYYMMDD>-<HHMMSS>-<8 hex chars>`
 */
export async function createRunContext(
  input: CreateRunContextInput,
): Promise<RunContext> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const stamp = formatTimestamp(now);
  const random = randomBytes(4).toString("hex");
  const runId = `${input.app}-${input.subcommand}-${stamp}-${random}`;

  const baseDir =
    env.SAAGA_DIR && env.SAAGA_DIR.length > 0
      ? env.SAAGA_DIR
      : env.HOME && env.HOME.length > 0
      ? resolve(env.HOME, ".saaga")
      : (() => {
          throw new Error(
            "Cannot determine run directory: HOME is not set and SAAGA_DIR is not provided",
          );
        })();

  const runDir = resolve(baseDir, "runs", runId);
  await mkdir(runDir, { recursive: true });

  return {
    app: input.app,
    appPath: input.appPath,
    subcommand: input.subcommand,
    runId,
    runDir,
    date: formatDate(now),
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
