import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import pc from "picocolors";
import { buildCodexArgs } from "../agent/codex-agent.js";
import {
  BUILTIN_MODEL_KEYS,
  createAgent,
  type Backend,
  backendCliCommand,
  mergeModelOverrides,
  resolveModel,
} from "../cli/backend.js";
import type { BackendConfig } from "../cli/config.js";
import { runFullSideEffectProbes, type FullProbeRunOptions } from "./full-probes.js";
import { runKiroAccountProbes } from "./kiro-probes.js";
import { PROBE_CATALOGUE, type ProbeRunResult, type ProbeLevel } from "./probes.js";
import {
  BACKEND_HELP_ARGS,
  findMissingRequiredFlags,
  REQUIRED_CLI_FLAGS,
} from "./required-flags.js";

export interface DoctorOptions {
  backend: Backend | "all";
  fast?: boolean;
  level: ProbeLevel;
  json?: boolean;
  probe?: string[];
  /** CLI `--model <key>=<model>` overrides, applied to every backend probed. */
  modelOverrides?: Record<string, string>;
  /** Per-backend config from `.saaga/config.yaml` (optional). */
  backendModels?: Partial<Record<Backend, BackendConfig>>;
  /**
   * The model ids a run will use, for probes that check them against the
   * account (`kiro/models-available`). Preflight passes the run's resolved
   * models. Without them, doctor resolves the built-in keys against
   * `backendModels` and `modelOverrides`.
   */
  models?: readonly string[];
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

function runFastProbes(
  backend: Backend,
  models: readonly string[],
  filterIds?: string[],
): ProbeRunResult[] {
  const results: ProbeRunResult[] = [];
  const applicable = PROBE_CATALOGUE.filter(
    (p) =>
      p.level === "fast" &&
      (!p.backends || p.backends.includes(backend)) &&
      (!filterIds || filterIds.includes(p.id)),
  );

  // Run the kiro probes in one call, so they skip the model check when the login check fails.
  const kiroResults = new Map(
    runKiroAccountProbes({
      probeIds: applicable.map((p) => p.id).filter((id) => id.startsWith("kiro/")),
      models,
    }).map((r) => [r.probeId, r]),
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
    } else if (probe.id === "required-flags") {
      results.push(runRequiredFlagsProbe(backend));
    } else if (kiroResults.has(probe.id)) {
      results.push(kiroResults.get(probe.id)!);
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

/**
 * Ask the backend CLI for its help text and assert every flag Saaga passes
 * during agent runs is still documented. Catches flag removals/renames
 * without spending tokens.
 */
function runRequiredFlagsProbe(backend: Backend): ProbeRunResult {
  const bin = backendCliCommand(backend);
  const t0 = Date.now();
  const help = readCliHelp(bin, BACKEND_HELP_ARGS[backend] ?? []);
  if (help === undefined) {
    return {
      probeId: "required-flags",
      backend,
      status: "fail",
      exitCode: 1,
      elapsed: Date.now() - t0,
      error: "CLI help query failed (--help and -h)",
    };
  }

  const missing = findMissingRequiredFlags(help, REQUIRED_CLI_FLAGS[backend]);
  if (missing.length > 0) {
    return {
      probeId: "required-flags",
      backend,
      status: "fail",
      exitCode: 1,
      elapsed: Date.now() - t0,
      error: `missing flags: ${missing.join(", ")}`,
    };
  }

  return {
    probeId: "required-flags",
    backend,
    status: "pass",
    exitCode: 0,
    elapsed: Date.now() - t0,
  };
}

/** Prefer `--help`; fall back to `-h` when the long form is unavailable. */
function readCliHelp(bin: string, prefix: readonly string[]): string | undefined {
  for (const flag of ["--help", "-h"] as const) {
    try {
      const out = execFileSync(bin, [...prefix, flag], { stdio: "pipe", timeout: 10_000 });
      return out.toString("utf8");
    } catch (err) {
      const text = bufferText(
        (err as { stdout?: Buffer | string }).stdout,
        (err as { stderr?: Buffer | string }).stderr,
      );
      if (text.trim().length > 0) return text;
    }
  }
  return undefined;
}

/** The CLI's error line: the last line that mentions an error, else the last line. */
function errorLine(output: string): string {
  // eslint-disable-next-line no-control-regex
  const lines = output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const line = [...lines].reverse().find((l) => /error|denied|invalid|login/i.test(l)) ?? lines.at(-1) ?? "(no output)";
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}

function bufferText(...parts: Array<Buffer | string | undefined>): string {
  return parts
    .map((p) => {
      if (p === undefined) return "";
      return typeof p === "string" ? p : p.toString("utf8");
    })
    .join("");
}

const BOGUS_MODEL = "saaga-nonexistent-model-probe-00000";

function runUnknownModelProbe(backend: Backend): ProbeRunResult {
  const bin = backendCliCommand(backend);
  const bogusModel = BOGUS_MODEL;
  const t0 = Date.now();
  try {
    const args =
      backend === "codex"
        ? buildCodexArgs(bogusModel, "Reply hello without using tools.", {
            cwd: process.cwd(),
            permissions: { readRoots: [process.cwd()], writeRoots: [], denyPaths: [], shell: "none" },
          })
        : backend === "copilot"
          ? ["-p", "hello", "--no-ask-user", "--model", bogusModel, "--no-auto-update"]
          : backend === "cursor"
            ? ["--print", "--trust", "--model", bogusModel, "--output-format", "text", "hello"]
            : backend === "kiro"
              ? ["chat", "--no-interactive", "--v3", "--model", bogusModel, "hello"]
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
    return {
      probeId: "unknown-model-fails",
      backend,
      ...unknownModelOutcome(backend, err, bogusModel),
      elapsed: Date.now() - t0,
    };
  }
}

/**
 * Turn the error from the bogus-model command into a probe result. The CLI
 * rejected the model only if it exited non-zero and its output names the
 * model. A CLI that is not logged in also exits non-zero, with a login
 * error that does not name the model, so that fails the probe too. Codex
 * prints the model in its startup header, so it must report a model
 * rejection, not merely echo the requested name.
 *
 * After a timeout, a signal or a failed spawn, `status` is null, so the
 * probe fails. A logged-out kiro causes this, because it waits for a browser
 * login until the timeout stops it.
 */
export function unknownModelOutcome(
  backend: Backend,
  err: unknown,
  bogusModel: string,
): Pick<ProbeRunResult, "status" | "exitCode" | "error"> {
  const e = err as {
    status?: number | null;
    signal?: string | null;
    code?: string;
    stdout?: Buffer | string;
    stderr?: Buffer | string;
  };
  if (typeof e.status === "number") {
    if (e.status === 0) {
      return { status: "fail", exitCode: 0, error: "expected non-zero exit for bogus model, but got exit 0" };
    }
    const output = bufferText(e.stdout, e.stderr);
    if (backend === "codex") {
      const modelRejected = /model[^\n]*(?:does not exist|not found|not supported|not available|unsupported|unknown|invalid|unrecognized)/i.test(output);
      return modelRejected
        ? { status: "pass", exitCode: e.status }
        : {
            status: "fail",
            exitCode: e.status,
            error: "could not verify model rejection; check authentication, CLI configuration, and connectivity",
          };
    }
    if (output.includes(bogusModel)) return { status: "pass", exitCode: e.status };
    return {
      status: "fail",
      exitCode: e.status,
      error: `exited ${e.status} without naming the bogus model, so it never checked it: ${errorLine(output)}`,
    };
  }
  const cause =
    e.code === "ETIMEDOUT"
      ? "timed out"
      : e.signal
        ? `was ended by ${e.signal}`
        : `could not run (${e.code ?? "unknown error"})`;
  const hint = backend === "kiro" && e.code === "ETIMEDOUT" ? "; is kiro-cli logged in?" : "";
  return {
    status: "fail",
    exitCode: 1,
    error: `the bogus-model command ${cause} before rejecting the model${hint}`,
  };
}

export async function runDoctor(opts: DoctorOptions): Promise<DoctorResult> {
  if (opts.fast !== undefined && opts.backend !== "codex") {
    throw new Error("--fast and --no-fast require --backend codex");
  }
  const backends: Backend[] =
    opts.backend === "all" ? ["cursor", "copilot", "claude", "kiro", "codex"] : [opts.backend];

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
    const configuredModels = mergeModelOverrides(
      opts.backendModels?.[backend]?.models,
      opts.modelOverrides,
    );
    const models =
      opts.models ?? BUILTIN_MODEL_KEYS.map((key) => resolveModel(backend, key, configuredModels));

    let probes: ProbeRunResult[];
    if (opts.level === "fast") {
      probes = runFastProbes(backend, models, filterIds);
    } else {
      const fastResults = runFastProbes(backend, models, filterIds).map((r) => {
        if (r.probeId === "unknown-model-fails") {
          return runUnknownModelProbe(backend);
        }
        return r;
      });

      // Doctor probes always use the `low` model key.
      const model = resolveModel(
        backend,
        "low",
        mergeModelOverrides(
          opts.backendModels?.[backend]?.models,
          opts.modelOverrides,
        ),
      );
      const agent = createAgent({ backend, model, fast: opts.fast ?? opts.backendModels?.[backend]?.fast });
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

      if (p.classification === "transient") {
        lines.push(
          `         Passed on retry (${p.retries} ${p.retries === 1 ? "retry" : "retries"}) — probe is flaky.`,
        );
      } else if (p.classification === "policy-denial") {
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
