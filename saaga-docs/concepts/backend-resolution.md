# Backend Resolution

## Business Definition

Backend resolution is the process by which Saaga determines which AI agent CLI to invoke. The system supports three backends — `cursor`, `copilot`, and `claude` — and uses a precedence chain of CLI flags and project configuration to select one. After resolving the backend, the system determines the AI model via an open **model key** map (`low`, `medium`, `high`, plus any custom keys) and constructs the agent. Backends are expected to handle their own authentication.

## Configuration

| Source | Description |
|--------|-------------|
| `--backend` flag (`-b`) | Highest-priority backend selector; passed as a global CLI option |
| `.saaga/config.yaml` `defaultBackend` field | Fallback when `--backend` is not provided (see [Project Configuration](./project-configuration.md)) |
| `--model <key>=<model>` flag (repeatable) | Per-key model overrides; e.g. `--model high=opus` |
| `.saaga/config.yaml` `backends.<name>.models` | Per-backend open map of model key → model name when CLI flags are not provided |

**How to access:**

- `resolveBackend(input)` — resolves the backend name from `--backend` flag → `config.defaultBackend` → error
- `parseModelOverrides(entries)` — parses repeatable `--model <key>=<model>` CLI values into a map
- `mergeModelOverrides(configModels?, cliOverrides?)` — merges config and CLI maps (CLI wins per key)
- `resolveModel(backend, key, models?)` — returns the model string for a model key: consults `models[key]`, then built-in defaults for `low`/`medium`/`high`, otherwise errors
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

For a given model key:
```
--model <key>=<model>  →  config.backends.<backend>.models.<key>  →  built-in default (low/medium/high only)  →  BackendError
```

Callers typically fold CLI overrides into the config map with `mergeModelOverrides()` before calling `resolveModel()`.

Built-in keys used by bundled commands:
- **`high`**: `init`, `update`, `verify-quick-updates` (override with `--model high=<model>`)
- **`medium`**: `quick-update` (override with `--model medium=<model>`; cheaper/faster by default)
- **`low`**: `doctor` probes (override with `--model low=<model>`)

Custom keys (e.g. `triage`) may be defined under `backends.<name>.models` for custom flows; they have no built-in default — asking for an undefined custom key is an error. Keys must match `MODEL_KEY_PATTERN`: lowercase, start with a letter, then `a-z`, `0-9`, `-`, `_`.

### Built-in Default Models by Backend and Key

| Backend | `low` | `medium` | `high` |
|---------|-------|----------|--------|
| `cursor` | `composer-2.5` | `cursor-grok-4.5-high` | `claude-4.6-opus-high-thinking` |
| `copilot` | `claude-haiku-4.5` | `claude-sonnet-4.6` | `claude-sonnet-4.6` |
| `claude` | `haiku` | `sonnet` | `opus` |

## Data Storage

| Type | Field/Property | Purpose |
|------|----------------|---------|
| `Backend` | (type alias) | String union: `"cursor" \| "copilot" \| "claude"` |
| `ModelKey` | (type alias) | String naming a model slot; built-in keys are `low` / `medium` / `high` |
| `BuiltinModelKey` | (type alias) | `"low" \| "medium" \| "high"` — the only keys with built-in defaults |
| `ResolveBackendInput` | `flag` | Optional `--backend` value from CLI flags |
| `ResolveBackendInput` | `config` | Optional `config.defaultBackend` string from `.saaga/config.yaml` |
| `CreateAgentOptions` | `backend` | Resolved `Backend` value |
| `CreateAgentOptions` | `model` | Resolved model string |
| `CreateAgentOptions` | `ci` | Optional CI mode flag (affects agent output format) |

### Internal Constants (not exported)

| Constant | Purpose |
|----------|---------|
| `ALLOWED_BACKENDS` | Readonly array `["cursor", "copilot", "claude"]` used for validation |
| `DEFAULT_BACKEND_MODELS` | Maps each backend to its built-in `low` / `medium` / `high` model defaults |
| `BACKEND_CLI_COMMANDS` | Maps each backend to its CLI binary name: `cursor` → `"cursor-agent"`, `copilot` → `"copilot"`, `claude` → `"claude"` |

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/cli/backend.ts` | `resolveBackend()` | Resolve backend from `--backend` flag → `config.defaultBackend` → error |
| `src/cli/backend.ts` | `parseModelOverrides()` | Parse `--model <key>=<model>` entries into a map (last value wins per key) |
| `src/cli/backend.ts` | `mergeModelOverrides()` | Merge config models with CLI overrides (CLI wins per key) |
| `src/cli/backend.ts` | `resolveModel()` | Return the model string for a key: `models[key]` → built-in default → error |
| `src/cli/backend.ts` | `createAgent()` | Construct a `CursorAgent`, `CopilotAgent`, or `ClaudeAgent` for the resolved backend |
| `src/cli/backend.ts` | `backendCliCommand()` | Return the CLI binary name for a given backend (e.g. `"cursor"` → `"cursor-agent"`); used by the cost confirmation notice |
| `src/cli/backend.ts` | `isValidModelKey()` | Validate a model key against `MODEL_KEY_PATTERN` |
| `src/cli/backend.ts` | `BackendError` (class) | Error class thrown for backend/model resolution failures |
| `src/cli/backend.ts` | `Backend` (type) | String union type: `"cursor" \| "copilot" \| "claude"` |
| `src/cli/backend.ts` | `ModelKey` (type) | String type for model keys |
| `src/cli/backend.ts` | `BuiltinModelKey` (type) | `"low" \| "medium" \| "high"` |
| `src/cli/backend.ts` | `BUILTIN_MODEL_KEYS` (constant) | Readonly `["low", "medium", "high"]` |
| `src/cli/backend.ts` | `MODEL_KEY_PATTERN` (constant) | Regex `/^[a-z][a-z0-9_-]*$/` |
| `src/cli/backend.ts` | `ResolveBackendInput` (interface) | Input shape for `resolveBackend()` |
| `src/cli/backend.ts` | `CreateAgentOptions` (interface) | Input shape for `createAgent()` |

## Internal Implementation

- `resolveAgent()` in `src/cli.ts` — orchestrates the full resolution sequence: if `CliOptions.agent` is provided (test mode), returns it directly; otherwise calls `resolveBackend()` with the config → selects a built-in key (`"medium"` for `quick-update`, `"high"` for all other flow subcommands) → `mergeModelOverrides(config.backends?.[backend]?.models, parseModelOverrides(globals.model))` → `resolveModel(backend, key, models)` → `createAgent()`. Not exported.

## Error Handling

| Scenario | Error |
|----------|-------|
| Neither `--backend` nor `config.defaultBackend` provided | `BackendError: "Backend must be specified via --backend flag or .saaga/config.yaml"` |
| Invalid backend value (not `cursor`, `copilot`, or `claude`) | `BackendError: "Invalid backend: <name> (must be 'cursor', 'copilot', or 'claude')"` |
| Invalid `--model` value (missing `=`, empty key/model, or bad key shape) | `BackendError` describing the parse failure |
| Unknown model key with no config value and no built-in default | `BackendError: "Unknown model key '<key>' for backend '<backend>' (available: ...)"` |

## Reference Implementations

- `src/cli/backend.ts` — the canonical module containing all resolution, validation, and construction logic
- `tests/cli/backend.test.ts` — comprehensive test suite covering flag precedence, config fallback, empty values, and unknown backends

## Related Concepts

- [Project Configuration](./project-configuration.md) — how `.saaga/config.yaml` provides fallback values for backend and per-backend models
- [Agent Interface](./agent-interface.md) — the `Agent` contract that backends implement
- [Cost Confirmation](./cost-confirmation.md) — uses `backendCliCommand()` to display the CLI binary name in the cost notice
- [Run Context and Isolation](./run-context.md) — how the resolved agent is paired with a run directory
