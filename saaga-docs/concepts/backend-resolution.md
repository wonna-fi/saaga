# Backend Resolution

## Business Definition

Backend resolution is the process by which Saaga determines which AI agent CLI to invoke. The system supports three backends — `cursor`, `copilot`, and `claude` — and uses a precedence chain of CLI flags and project configuration to select one. After resolving the backend, the system determines the AI model to use via a three-tier system (`low`, `medium`, `high`) and constructs the agent. Backends are expected to handle their own authentication.

## Configuration

| Source | Description |
|--------|-------------|
| `--backend` flag (`-b`) | Highest-priority backend selector; passed as a global CLI option |
| `.saaga/config.yaml` `defaultBackend` field | Fallback when `--backend` is not provided (see [Project Configuration](./project-configuration.md)) |
| `--model-low/--model-medium/--model-high` flags | Per-tier model overrides; apply to the corresponding quality tier |
| `.saaga/config.yaml` `backends.<name>.modelLow/Medium/High` | Per-backend, per-tier model overrides when CLI flags are not provided |

**How to access:**

- `resolveBackend(input)` — resolves the backend name from `--backend` flag → `config.defaultBackend` → error
- `resolveModelForTier(backend, tier, configModels?)` — returns the model string for a given quality tier, consulting per-backend config overrides before falling back to built-in defaults
- `createAgent(opts)` — constructs a concrete `Agent` instance from the resolved backend, model, and CI flag

### Backend Resolution Precedence

```
--backend flag  →  .saaga/config.yaml defaultBackend  →  BackendError
     ↓                       ↓                                  ↓
 validate against        validate against               "Backend must be specified
 ALLOWED_BACKENDS        ALLOWED_BACKENDS                via --backend flag or
                                                        .saaga/config.yaml"
```

Empty strings are treated as absent — an empty `--backend ""` or an empty `config.defaultBackend` value is ignored.

### Model Resolution Precedence

Each quality tier is resolved independently. For a given tier:
```
--model-<tier> flag  →  config.backends.<backend>.model<Tier>  →  built-in default
```

Tier assignment by subcommand:
- **high** tier: `init`, `update`, `verify-quick-updates` (the `--model-high` flag applies)
- **medium** tier: `quick-update` (the `--model-medium` flag applies; uses a cheaper/faster model by default)
- **low** tier: `doctor` probes (the `--model-low` flag applies)

### Built-in Default Models by Backend and Tier

| Backend | `low` | `medium` | `high` |
|---------|-------|----------|--------|
| `cursor` | `composer-2.5` | `cursor-grok-4.5-high` | `claude-4.6-opus-high-thinking` |
| `copilot` | `claude-haiku-4.5` | `claude-sonnet-4.6` | `claude-sonnet-4.6` |
| `claude` | `haiku` | `sonnet` | `opus` |

## Data Storage

| Type | Field/Property | Purpose |
|------|----------------|---------|
| `Backend` | (type alias) | String union: `"cursor" \| "copilot" \| "claude"` |
| `ModelTier` | (type alias) | String union: `"low" \| "medium" \| "high"` |
| `ResolveBackendInput` | `flag` | Optional `--backend` value from CLI flags |
| `ResolveBackendInput` | `config` | Optional `config.defaultBackend` string from `.saaga/config.yaml` |
| `CreateAgentOptions` | `backend` | Resolved `Backend` value |
| `CreateAgentOptions` | `model` | Resolved model string |
| `CreateAgentOptions` | `ci` | Optional CI mode flag (affects agent output format) |

### Internal Constants (not exported)

| Constant | Purpose |
|----------|---------|
| `ALLOWED_BACKENDS` | Readonly array `["cursor", "copilot", "claude"]` used for validation |
| `DEFAULT_BACKEND_MODELS` | Maps each backend to its `modelLow`, `modelMedium`, and `modelHigh` built-in defaults |
| `TIER_KEY` | Maps `ModelTier` values to the corresponding key in `BackendModelDefaults` |
| `BACKEND_CLI_COMMANDS` | Maps each backend to its CLI binary name: `cursor` → `"cursor-agent"`, `copilot` → `"copilot"`, `claude` → `"claude"` |

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/cli/backend.ts` | `resolveBackend()` | Resolve backend from `--backend` flag → `config.defaultBackend` → error |
| `src/cli/backend.ts` | `resolveModelForTier()` | Return the model string for a given tier: consults `configModels` then falls back to built-in default |
| `src/cli/backend.ts` | `createAgent()` | Construct a `CursorAgent`, `CopilotAgent`, or `ClaudeAgent` for the resolved backend |
| `src/cli/backend.ts` | `backendCliCommand()` | Return the CLI binary name for a given backend (e.g. `"cursor"` → `"cursor-agent"`); used by the cost confirmation notice |
| `src/cli/backend.ts` | `BackendError` (class) | Error class thrown for backend resolution failures |
| `src/cli/backend.ts` | `Backend` (type) | String union type: `"cursor" \| "copilot" \| "claude"` |
| `src/cli/backend.ts` | `ModelTier` (type) | String union type: `"low" \| "medium" \| "high"` |
| `src/cli/backend.ts` | `ResolveBackendInput` (interface) | Input shape for `resolveBackend()` |
| `src/cli/backend.ts` | `CreateAgentOptions` (interface) | Input shape for `createAgent()` |

## Internal Implementation

- `resolveAgent()` in `src/cli.ts` — orchestrates the full resolution sequence: if `CliOptions.agent` is provided (test mode), returns it directly; otherwise calls `resolveBackend()` with the config → selects a tier (`"medium"` for `quick-update`, `"high"` for all other flow subcommands) → applies the matching CLI flag override (`--model-medium` or `--model-high`) → calls `resolveModelForTier(backend, tier, config.backends?.[backend])` → `createAgent()`. Not exported.

## Error Handling

| Scenario | Error |
|----------|-------|
| Neither `--backend` nor `config.defaultBackend` provided | `BackendError: "Backend must be specified via --backend flag or .saaga/config.yaml"` |
| Invalid backend value (not `cursor`, `copilot`, or `claude`) | `BackendError: "Invalid backend: <name> (must be 'cursor', 'copilot', or 'claude')"` |

## Reference Implementations

- `src/cli/backend.ts` — the canonical module containing all resolution, validation, and construction logic
- `tests/cli/backend.test.ts` — comprehensive test suite covering flag precedence, config fallback, empty values, and unknown backends

## Related Concepts

- [Project Configuration](./project-configuration.md) — how `.saaga/config.yaml` provides fallback values for backend and per-backend model tiers
- [Agent Interface](./agent-interface.md) — the `Agent` contract that backends implement
- [Cost Confirmation](./cost-confirmation.md) — uses `backendCliCommand()` to display the CLI binary name in the cost notice
- [Run Context and Isolation](./run-context.md) — how the resolved agent is paired with a run directory
