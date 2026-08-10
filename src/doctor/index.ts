import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import pc from "picocolors";
import {
  createAgent,
  type Backend,
  backendCliCommand,
  resolveModelForTier,
} from "../cli/backend.js";
import type { BackendModels } from "../cli/config.js";
import { runFullSideEffectProbes, type FullProbeRunOptions } from "./full-probes.js";
import { PROBE_CATALOGUE, type ProbeRunResult, type ProbeLevel } from "./probes.js";

export interface DoctorOptions {
  backend: Backend | "all";
  level: ProbeLevel;
  json?: boolean;
  probe?: string[];
  /** Model override for full-tier probes (uses modelLow when absent). */
  model?: string;
  /** Per-backend model config from `.saaga/config.yaml` (optional). */
  backendModels?: Partial<Record<Backend, BackendModels>>;
  /** CI mode — plain output without spinners or colors. */
  ci?: boolean;
  /** Working directory; logs are placed under `<cwd>/.saaga-runs/doctor/`. */
  cwd?: string;
}

export interface DoctorResult {
  schemaVersion: 1;
  backends: DoctorBackendResult[];
  exitCode: number;
  /** Directory containing per-backend probe logs (only for full-tier runs). */
  logDir?: string;
}

export interface DoctorBackendResult {
  backend: Backend;
  available: boolean;
  reason?: string;
  version?: string;
  probes: ProbeRunResult[];
}

/** Exit codes: 0 = all passed, 1 = at least one failed, 2 = could-not-run. */
function computeExitCode(results: DoctorBackendResult[]): number {
  let hasFail = false;
  let hasPass = false;
  let hasAvailable = false;
  for (const r of results) {
    if (!r.available) continue;
    hasAvailable = true;
    for (const p of r.probes) {
      if (p.status === "fail") hasFail = true;
      if (p.status === "pass") hasPass = true;
    }
  }
  if (hasFail) return 1;
  if (!hasAvailable) return 2;
  // All probes skipped (e.g. filtering to a probe that doesn't apply at
  // this level) is not a failure — there was nothing to fail.
  if (!hasPass) return 0;
  return 0;
}

function isBackendAvailable(backend: Backend): { available: boolean; reason?: string; version?: string } {
  const bin = backendCliCommand(backend);
  try {
    execFileSync("which", [bin], { stdio: "pipe" });
  } catch {
    return { available: false, reason: `'${bin}' not found on PATH` };
  }

  let version: string | undefined;
  try {
    const out = execFileSync(bin, ["--version"], { stdio: "pipe", timeout: 10_000 });
    version = out.toString().trim().split("\n")[0];
  } catch {
    version = "unknown";
  }

  return { available: true, version };
}

function runFastProbes(backend: Backend, filterIds?: string[]): ProbeRunResult[] {
  const results: ProbeRunResult[] = [];
  const applicable = PROBE_CATALOGUE.filter(
    (p) =>
      p.level === "fast" &&
      (!p.backends || p.backends.includes(backend)) &&
      (!filterIds || filterIds.includes(p.id)),
  );

  for (const probe of applicable) {
    if (probe.id === "version") {
      const bin = backendCliCommand(backend);
      try {
        execFileSync(bin, ["--version"], { stdio: "pipe", timeout: 10_000 });
        results.push({
          probeId: probe.id,
          backend,
          status: "pass",
          exitCode: 0,
          elapsed: 0,
        });
      } catch {
        results.push({
          probeId: probe.id,
          backend,
          status: "fail",
          exitCode: 1,
          elapsed: 0,
          error: "version query failed",
        });
      }
    } else if (probe.id === "unknown-model-fails") {
      results.push({
        probeId: probe.id,
        backend,
        status: "skip",
        exitCode: 0,
        elapsed: 0,
        error: "requires model call (use --level full)",
      });
    } else {
      results.push({
        probeId: probe.id,
        backend,
        status: "skip",
        exitCode: 0,
        elapsed: 0,
      });
    }
  }

  return results;
}

function runUnknownModelProbe(backend: Backend): ProbeRunResult {
  const bin = backendCliCommand(backend);
  const bogusModel = "saaga-nonexistent-model-probe-00000";
  const t0 = Date.now();
  try {
    const args =
      backend === "copilot"
        ? ["-p", "hello", "--no-ask-user", "--model", bogusModel, "--no-auto-update"]
        : backend === "cursor"
          ? ["--print", "--trust", "--model", bogusModel, "--output-format", "text", "hello"]
          : ["--print", "--permission-mode", "dontAsk", "--model", bogusModel, "hello"];

    execFileSync(bin, args, { stdio: "pipe", timeout: 30_000 });
    return {
      probeId: "unknown-model-fails",
      backend,
      status: "fail",
      exitCode: 0,
      elapsed: Date.now() - t0,
      error: "expected non-zero exit for bogus model, but got exit 0",
    };
  } catch (err) {
    const exitCode = (err as { status?: number }).status ?? 1;
    return {
      probeId: "unknown-model-fails",
      backend,
      status: exitCode !== 0 ? "pass" : "fail",
      exitCode,
      elapsed: Date.now() - t0,
    };
  }
}

/** Doctor probes always use the low-tier model. */
function probeModelFor(
  backend: Backend,
  override?: string,
  configModels?: BackendModels,
): string {
  if (override && override.length > 0) return override;
  return resolveModelForTier(backend, "low", configModels);
}

export async function runDoctor(opts: DoctorOptions): Promise<DoctorResult> {
  const backends: Backend[] =
    opts.backend === "all" ? ["cursor", "copilot", "claude"] : [opts.backend];

  let logDir: string | undefined;
  if (opts.level === "full") {
    const cwd = opts.cwd ?? process.cwd();
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    logDir = join(cwd, ".saaga-runs", "doctor", ts);
    await mkdir(logDir, { recursive: true });
  }

  const results: DoctorBackendResult[] = [];

  for (const backend of backends) {
    const avail = isBackendAvailable(backend);
    if (!avail.available) {
      results.push({
        backend,
        available: false,
        reason: avail.reason,
        probes: [],
      });
      continue;
    }

    const filterIds = opts.probe && opts.probe.length > 0 ? opts.probe : undefined;

    let probes: ProbeRunResult[];
    if (opts.level === "fast") {
      probes = runFastProbes(backend, filterIds);
    } else {
      const fastResults = runFastProbes(backend, filterIds).map((r) => {
        if (r.probeId === "unknown-model-fails") {
          return runUnknownModelProbe(backend);
        }
        return r;
      });

      const model = probeModelFor(backend, opts.model, opts.backendModels?.[backend]);
      const agent = createAgent({ backend, model });
      const runOpts: FullProbeRunOptions = {
        backend,
        agent,
        filterIds,
        quiet: opts.json,
        ci: opts.ci,
        logFile: logDir ? join(logDir, `${backend}.log`) : undefined,
      };
      const fullResults = await runFullSideEffectProbes(runOpts);

      probes = [...fastResults, ...fullResults];
    }

    results.push({
      backend,
      available: true,
      version: avail.version,
      probes,
    });
  }

  return {
    schemaVersion: 1,
    backends: results,
    exitCode: computeExitCode(results),
    logDir,
  };
}

export function formatDoctorResult(result: DoctorResult, opts?: { ci?: boolean }): string {
  const plain = opts?.ci ?? false;
  const lines: string[] = [];

  for (const br of result.backends) {
    lines.push(`\n${br.backend}:`);
    if (!br.available) {
      const tag = plain ? "NOT AVAILABLE" : pc.red("NOT AVAILABLE");
      lines.push(`  ${tag}: ${br.reason}`);
      continue;
    }
    lines.push(`  version: ${br.version ?? "unknown"}`);
    for (const p of br.probes) {
      const tag = formatStatusTag(p.status, plain);
      const error = p.error ? ` — ${p.error}` : "";
      lines.push(`  ${tag} ${p.probeId}${error}`);

      if (p.classification === "policy-denial") {
        lines.push(
          `         Succeeds without the permission profile, so the profile is too tight here.`,
        );
      } else if (p.classification === "backend-failure") {
        lines.push(
          `         Fails without the permission profile too, so the CLI or environment is at fault.`,
        );
      }
    }
  }

  const summary =
    result.exitCode === 0
      ? plain ? "All probes passed." : pc.green("All probes passed.")
      : result.exitCode === 1
        ? plain ? "Some probes failed." : pc.red("Some probes failed.")
        : "Could not run probes (binary missing or no credentials).";
  lines.push(`\n${summary}`);

  if (result.exitCode !== 0 && result.logDir) {
    lines.push(`Logs: ${result.logDir}`);
  }

  return lines.join("\n");
}

function formatStatusTag(status: string, plain: boolean): string {
  const label = `[${status.toUpperCase().padEnd(4)}]`;
  if (plain) return label;
  switch (status) {
    case "pass": return pc.green(label);
    case "fail": return pc.red(label);
    case "skip": return pc.dim(label);
    default: return label;
  }
}
