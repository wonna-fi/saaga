import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Scope } from "./engine/types.js";
import { DEFAULT_MODEL_KEY } from "./model-keys.js";

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
  /**
   * Resolved model key -> model name for every key the run's flow asked for.
   * Re-pinned on resume so a config change between attempts cannot silently
   * move a half-finished run onto different models.
   */
  models?: Record<string, string>;
  /** @deprecated Legacy single-model pin; read via `manifestModels()`. */
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

/**
 * The model pins to reapply when resuming a run.
 *
 * Manifests written before per-step models pinned a single key. Reading that
 * legacy value as the default key is exact rather than approximate: adding
 * `model:` to a flow changes its hash, so the only flows that can still resume
 * across the upgrade are the ones left untouched — which are precisely the
 * ones that ran on the default key.
 */
export function manifestModels(
  manifest: RunManifest,
): Record<string, string> | undefined {
  if (manifest.models) return manifest.models;
  return manifest.model
    ? { [DEFAULT_MODEL_KEY]: manifest.model }
    : undefined;
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
