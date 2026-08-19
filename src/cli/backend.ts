import { ClaudeAgent } from "../agent/claude-agent.js";
import { CopilotAgent } from "../agent/copilot-agent.js";
import { CursorAgent } from "../agent/cursor-agent.js";
import type { Agent } from "../agent/types.js";

export type Backend = "cursor" | "copilot" | "claude";

/**
 * Names a model slot a flow can ask for. `low`, `medium`, and `high` are
 * built in and have per-backend defaults; any other key must be supplied by
 * the user via `.saaga/config.yaml` or `--model`.
 */
export type ModelKey = string;

/** Model keys the built-in flows use, and the only keys with built-in defaults. */
export const BUILTIN_MODEL_KEYS = ["low", "medium", "high"] as const;

export type BuiltinModelKey = (typeof BUILTIN_MODEL_KEYS)[number];

/** Lowercase, starts with a letter, then any of a-z 0-9 `_` `-`. */
export const MODEL_KEY_PATTERN = /^[a-z][a-z0-9_-]*$/;

export function isValidModelKey(key: string): boolean {
  return MODEL_KEY_PATTERN.test(key);
}

const ALLOWED_BACKENDS: readonly Backend[] = ["cursor", "copilot", "claude"];

const DEFAULT_BACKEND_MODELS: Record<
  Backend,
  Record<BuiltinModelKey, string>
> = {
  cursor: {
    low: "composer-2.5",
    medium: "cursor-grok-4.5-high",
    high: "claude-4.6-opus-high-thinking",
  },
  copilot: {
    low: "claude-haiku-4.5",
    medium: "claude-sonnet-4.6",
    high: "claude-sonnet-4.6",
  },
  claude: {
    low: "haiku",
    medium: "sonnet",
    high: "opus",
  },
};

const BACKEND_CLI_COMMANDS: Record<Backend, string> = {
  cursor: "cursor-agent",
  copilot: "copilot",
  claude: "claude",
};

export class BackendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendError";
  }
}

export interface ResolveBackendInput {
  flag?: string;
  config?: string;
}

/**
 * Resolves the backend from:
 *   1. `--backend <name>` flag if provided
 *   2. `.saaga/config.yaml` `defaultBackend` field as fallback
 *   3. Otherwise: error
 */
export function resolveBackend(input: ResolveBackendInput): Backend {
  const candidate =
    (input.flag && input.flag.length > 0 ? input.flag : undefined) ??
    (input.config && input.config.length > 0 ? input.config : undefined);

  if (!candidate) {
    throw new BackendError(
      "Backend must be specified via --backend flag or .saaga/config.yaml",
    );
  }
  if (!ALLOWED_BACKENDS.includes(candidate as Backend)) {
    throw new BackendError(
      `Invalid backend: ${candidate} (must be 'cursor', 'copilot', or 'claude')`,
    );
  }
  return candidate as Backend;
}

/**
 * Parses repeatable `--model <key>=<model>` entries into a map.
 *
 * Splits on the first `=` only, so model names may contain `=`. Key and
 * value are trimmed. A repeated key takes its last value.
 */
export function parseModelOverrides(
  entries: readonly string[],
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const entry of entries) {
    const eq = entry.indexOf("=");
    if (eq === -1) {
      throw new BackendError(
        `Invalid --model value '${entry}' (expected '<key>=<model>')`,
      );
    }

    const key = entry.slice(0, eq).trim();
    const model = entry.slice(eq + 1).trim();

    if (key.length === 0) {
      throw new BackendError(
        `Invalid --model value '${entry}': model key must not be empty`,
      );
    }
    if (model.length === 0) {
      throw new BackendError(
        `Invalid --model value '${entry}': model must not be empty`,
      );
    }
    if (!isValidModelKey(key)) {
      throw new BackendError(
        `Invalid --model key '${key}': keys must be lowercase and start with ` +
          `a letter (allowed: a-z, 0-9, '-', '_')`,
      );
    }

    result[key] = model;
  }

  return result;
}

/**
 * Combines configured models with CLI overrides. Overrides win per key, so
 * `--model high=x` leaves every other configured key intact. Neither input
 * is mutated.
 */
export function mergeModelOverrides(
  configModels?: Record<string, string>,
  cliOverrides?: Record<string, string>,
): Record<string, string> {
  return { ...(configModels ?? {}), ...(cliOverrides ?? {}) };
}

/** Built-in keys first, then any extra configured keys, for error messages. */
function availableModelKeys(models?: Record<string, string>): string[] {
  const builtins: readonly string[] = BUILTIN_MODEL_KEYS;
  const extra = Object.keys(models ?? {}).filter((k) => !builtins.includes(k));
  return [...BUILTIN_MODEL_KEYS, ...extra];
}

/**
 * Resolves the model string for a model key.
 *
 * Precedence: `models[key]` -> built-in default for the backend -> error.
 * Empty values count as absent. Callers fold CLI overrides into `models`
 * with `mergeModelOverrides()` before calling.
 *
 * The `typeof` guards are load-bearing: `noUncheckedIndexedAccess` is off,
 * and inherited keys like `constructor` satisfy `MODEL_KEY_PATTERN`, so an
 * unguarded lookup can yield a function rather than a model name.
 */
export function resolveModel(
  backend: Backend,
  key: ModelKey,
  models?: Record<string, string>,
): string {
  const fromMap = models?.[key];
  if (typeof fromMap === "string" && fromMap.length > 0) {
    return fromMap;
  }

  const builtin = (DEFAULT_BACKEND_MODELS[backend] as Record<string, string>)[
    key
  ];
  if (typeof builtin === "string" && builtin.length > 0) {
    return builtin;
  }

  throw new BackendError(
    `Unknown model key '${key}' for backend '${backend}' ` +
      `(available: ${availableModelKeys(models).join(", ")}). ` +
      `Define it under 'backends.${backend}.models' in .saaga/config.yaml ` +
      `or pass '--model ${key}=<model>'.`,
  );
}

/** The CLI binary Saaga executes for a backend. */
export function backendCliCommand(backend: Backend): string {
  return BACKEND_CLI_COMMANDS[backend];
}

export interface CreateAgentOptions {
  backend: Backend;
  model: string;
  ci?: boolean;
}

/** Constructs the concrete `Agent` for a backend. */
export function createAgent(opts: CreateAgentOptions): Agent {
  if (opts.backend === "cursor") {
    return new CursorAgent({ model: opts.model, ci: opts.ci });
  }
  if (opts.backend === "copilot") {
    return new CopilotAgent({ model: opts.model, ci: opts.ci });
  }
  if (opts.backend === "claude") {
    return new ClaudeAgent({ model: opts.model, ci: opts.ci });
  }
  const _exhaustive: never = opts.backend;
  throw new BackendError(`Unsupported backend: ${_exhaustive}`);
}
