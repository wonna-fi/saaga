import { execFileSync } from "node:child_process";
import type { ProbeRunResult } from "./probes.js";

export interface KiroCommandResult {
  exitCode: number;
  stdout: string;
}

/** Runs `kiro-cli <args>`. Tests pass their own runner instead of the real CLI. */
export type KiroCommandRunner = (args: readonly string[]) => KiroCommandResult;

export const runKiroCli: KiroCommandRunner = (args) => {
  try {
    const out = execFileSync("kiro-cli", args, { stdio: "pipe", timeout: 30_000 });
    return { exitCode: 0, stdout: out.toString("utf8") };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: Buffer | string };
    return { exitCode: e.status ?? 1, stdout: e.stdout?.toString() ?? "" };
  }
};

export interface KiroProbeInput {
  /** Catalogue ids to run, in order: `kiro/auth`, `kiro/models-available`. */
  probeIds: readonly string[];
  /** Model ids the run will pass to `--model`. */
  models: readonly string[];
  env?: NodeJS.ProcessEnv;
  run?: KiroCommandRunner;
}

const LOGIN_REQUIRED = "kiro-cli is not logged in: run 'kiro-cli login' or set KIRO_API_KEY";

const API_KEY_REJECTED =
  "KIRO_API_KEY was not accepted: kiro-cli could not list models with it. " +
  "Check the value for stray whitespace, quotes or line breaks from pasting";

const API_KEY_AMBIGUOUS =
  "KIRO_API_KEY is set while kiro-cli is also logged in; kiro-cli answers this " +
  "check from the login, so the key can only be verified by a model call " +
  "(saaga doctor --backend kiro --level full)";

/** The result of the account check, computed once and shared by both probes. */
type AccountState =
  | { status: "ok" }
  | { status: "fail" | "skip"; reason: string };

/**
 * The kiro account probes. Neither makes a model call, so both run in the
 * preflight before every run.
 *
 * `kiro/auth` prevents a hang. A logged-out kiro does not fail. It starts a
 * browser login and waits for it indefinitely.
 *
 * With `KIRO_API_KEY` set and no stored login, `whoami` reports the account
 * type `ApiKey` without validating the key, and `--list-models` uses the
 * key. A rejected key returns only the `auto` fallback. With a stored login,
 * both commands answer from the login whatever the key is, so the probes
 * check the key only when kiro reports `ApiKey`.
 */
export function runKiroAccountProbes(input: KiroProbeInput): ProbeRunResult[] {
  if (input.probeIds.length === 0) return [];
  const env = input.env ?? process.env;
  const run = input.run ?? runKiroCli;

  let available: string[] | undefined;
  const account = checkAccount(Boolean(env.KIRO_API_KEY), run, (models) => {
    available = models;
  });

  const results: ProbeRunResult[] = [];
  for (const probeId of input.probeIds) {
    const t0 = Date.now();
    const done = (status: ProbeRunResult["status"], error?: string): void => {
      results.push({
        probeId,
        backend: "kiro",
        status,
        exitCode: status === "fail" ? 1 : 0,
        elapsed: Date.now() - t0,
        ...(error ? { error } : {}),
      });
    };

    if (probeId === "kiro/auth") {
      if (account.status === "ok") done("pass");
      else done(account.status, account.reason);
      continue;
    }

    if (probeId === "kiro/models-available") {
      if (account.status === "skip") {
        done("skip", account.reason);
        continue;
      }
      // Without working credentials, listing models can start the browser
      // login too.
      if (account.status === "fail") {
        done("skip", "requires working kiro credentials (see kiro/auth)");
        continue;
      }
      available ??= listModels(run);
      if (!available) {
        done("fail", "could not list kiro models (kiro-cli chat --list-models failed)");
        continue;
      }
      const missing = [...new Set(input.models)].filter((m) => !available!.includes(m));
      if (missing.length === 0) done("pass");
      else {
        done(
          "fail",
          `${missing.map((m) => `'${m}'`).join(", ")} not available on your kiro plan ` +
            `(available: ${available.join(", ")}); override with --model <key>=<model>`,
        );
      }
    }
  }
  return results;
}

function checkAccount(
  usingApiKey: boolean,
  run: KiroCommandRunner,
  onModelsListed: (models: string[]) => void,
): AccountState {
  const account = accountType(run);
  if (!usingApiKey) {
    return account ? { status: "ok" } : { status: "fail", reason: LOGIN_REQUIRED };
  }
  if (account && account !== "ApiKey") return { status: "skip", reason: API_KEY_AMBIGUOUS };

  const models = listModels(run);
  if (!models) return { status: "fail", reason: API_KEY_REJECTED };
  onModelsListed(models);
  return { status: "ok" };
}

/**
 * The account type `whoami` reports, such as `SocialGoogle` or `ApiKey`.
 * Undefined means `whoami` reported none, so kiro is logged out.
 */
function accountType(run: KiroCommandRunner): string | undefined {
  const result = run(["whoami", "--format", "json"]);
  if (result.exitCode !== 0) return undefined;
  try {
    const parsed = JSON.parse(result.stdout) as { accountType?: unknown } | null;
    const type = parsed?.accountType;
    return typeof type === "string" && type.length > 0 ? type : undefined;
  } catch {
    return undefined;
  }
}

function listModels(run: KiroCommandRunner): string[] | undefined {
  const result = run(["chat", "--list-models", "--format", "json"]);
  if (result.exitCode !== 0) return undefined;
  try {
    const parsed = JSON.parse(result.stdout) as { models?: Array<{ model_id?: unknown }> };
    const ids = (parsed.models ?? [])
      .map((m) => m.model_id)
      .filter((id): id is string => typeof id === "string");
    // Without usable credentials, kiro still exits 0 but lists only `auto`.
    return ids.some((id) => id !== "auto") ? ids : undefined;
  } catch {
    return undefined;
  }
}
