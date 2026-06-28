import { ClaudeAgent } from "../agent/claude-agent.js";
import { CopilotAgent } from "../agent/copilot-agent.js";
import { CursorAgent } from "../agent/cursor-agent.js";
import type { Agent } from "../agent/types.js";

export type Backend = "cursor" | "copilot" | "claude";

const ALLOWED_BACKENDS: readonly Backend[] = ["cursor", "copilot", "claude"];

const DEFAULT_MODELS: Record<Backend, string> = {
  cursor: "claude-4.6-opus-high-thinking",
  copilot: "claude-sonnet-4.5",
  claude: "opus",
};

const DEFAULT_QUICK_MODELS: Record<Backend, string> = {
  cursor: "claude-4.6-sonnet-medium-thinking",
  copilot: "claude-sonnet-4.5",
  claude: "sonnet",
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
 *   2. `.saaga/config.yaml` `backend` field as fallback
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

export function defaultModelFor(backend: Backend): string {
  return DEFAULT_MODELS[backend];
}

export function defaultQuickModelFor(backend: Backend): string {
  return DEFAULT_QUICK_MODELS[backend];
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
  throw new BackendError(`Unsupported backend: ${opts.backend}`);
}
