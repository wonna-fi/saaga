import { ClaudeAgent } from "../agent/claude-agent.js";
import { CopilotAgent } from "../agent/copilot-agent.js";
import { CursorAgent } from "../agent/cursor-agent.js";
import type { Agent } from "../agent/types.js";
import type { BackendModels } from "./config.js";

export type Backend = "cursor" | "copilot" | "claude";

export type ModelTier = "low" | "medium" | "high";

const ALLOWED_BACKENDS: readonly Backend[] = ["cursor", "copilot", "claude"];

interface BackendModelDefaults {
  modelLow: string;
  modelMedium: string;
  modelHigh: string;
}

const DEFAULT_BACKEND_MODELS: Record<Backend, BackendModelDefaults> = {
  cursor: {
    modelLow: "claude-4.6-sonnet-medium-thinking",
    modelMedium: "claude-4.6-sonnet-medium-thinking",
    modelHigh: "claude-4.6-opus-high-thinking",
  },
  copilot: {
    modelLow: "claude-sonnet-4.5",
    modelMedium: "claude-sonnet-4.5",
    modelHigh: "claude-sonnet-4.5",
  },
  claude: {
    modelLow: "sonnet",
    modelMedium: "sonnet",
    modelHigh: "opus",
  },
};

const TIER_KEY: Record<ModelTier, keyof BackendModelDefaults> = {
  low: "modelLow",
  medium: "modelMedium",
  high: "modelHigh",
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
 * Resolves the model string for a quality tier.
 *
 * Precedence: `configModels[tierKey]` → built-in default for the backend.
 * Callers that also accept CLI overrides should apply those before calling
 * this helper (or pass them via `configModels`).
 */
export function resolveModelForTier(
  backend: Backend,
  tier: ModelTier,
  configModels?: BackendModels,
): string {
  const key = TIER_KEY[tier];
  const fromConfig = configModels?.[key];
  if (fromConfig && fromConfig.length > 0) {
    return fromConfig;
  }
  return DEFAULT_BACKEND_MODELS[backend][key];
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
