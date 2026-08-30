import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Scope } from "./engine/types.js";

export type RunStatus = "running" | "interrupted" | "failed" | "completed";

export const RESUMABLE_STATUSES: readonly RunStatus[] = ["interrupted", "failed"];

/**
 * Everything a later process needs to pick a run up where it stopped,
 * stored as `<runDir>/run.json`. The step-level progress lives in the
 * journal next to it; this file holds the run's identity and outcome.
 */
export interface RunManifest {
  runId: string;
  flow: string;
  /** `flowHash()` of the flow definition the run started with. */
  flowHash: string;
  app: string;
  appPath: string;
  docsDir: string;
  backend?: string;
  model?: string;
  /** The exact scope `runFlow()` was started with. Reused verbatim on resume. */
  initialScope: Scope;
  status: RunStatus;
  /** Process that last owned the run; used to detect a stale `running`. */
  pid: number;
  startedAt: string;
  resumedAt: string[];
  lastError?: string;
}

export const MANIFEST_FILE = "run.json";

export function manifestPath(runDir: string): string {
  return resolve(runDir, MANIFEST_FILE);
}

/** Writes atomically: a kill mid-write leaves the previous manifest intact. */
export async function writeManifest(
  runDir: string,
  manifest: RunManifest,
): Promise<void> {
  const target = manifestPath(runDir);
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  await rename(tmp, target);
}

export async function readManifest(runDir: string): Promise<RunManifest> {
  const text = await readFile(manifestPath(runDir), "utf8");
  const parsed = JSON.parse(text) as Partial<RunManifest>;
  for (const key of ["runId", "flow", "flowHash", "status", "initialScope"] as const) {
    if (parsed[key] === undefined) {
      throw new Error(`run manifest ${manifestPath(runDir)} is missing '${key}'`);
    }
  }
  return parsed as RunManifest;
}

export interface ResumableRun {
  runDir: string;
  manifest: RunManifest;
}

/**
 * Finds the newest run under `<appPath>/.saaga-runs/` that stopped before
 * completing, optionally restricted to one flow. Directories without a
 * readable manifest (older runs, doctor logs) are skipped.
 */
export async function findResumableRun(
  appPath: string,
  flow?: string,
): Promise<ResumableRun | undefined> {
  const runsDir = resolve(appPath, ".saaga-runs");
  let entries: string[];
  try {
    entries = await readdir(runsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }

  const candidates: ResumableRun[] = [];
  for (const entry of entries) {
    const runDir = resolve(runsDir, entry);
    let manifest: RunManifest;
    try {
      manifest = await readManifest(runDir);
    } catch {
      continue;
    }
    if (!RESUMABLE_STATUSES.includes(manifest.status)) continue;
    if (flow && manifest.flow !== flow) continue;
    candidates.push({ runDir, manifest });
  }

  candidates.sort((a, b) =>
    b.manifest.startedAt.localeCompare(a.manifest.startedAt),
  );
  return candidates[0];
}

/** Whether the process recorded in the manifest is still alive. */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
