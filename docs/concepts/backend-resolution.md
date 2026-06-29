# Backend Resolution

## Business Definition

Backend resolution is the process by which Saaga determines which AI agent CLI to invoke. The system supports three backends — `cursor`, `copilot`, and `claude` — and uses a precedence chain of CLI flags and project configuration to select one. After resolving the backend, the system determines the AI model to use and constructs the agent. Backends are expected to handle their own authentication.

## Configuration

| Source | Description |
|--------|-------------|
| `--backend` flag (`-b`) | Highest-priority backend selector; passed as a global CLI option |
| `.saaga/config.yaml` `backend` field | Fallback when `--backend` is not provided (see [Project Configuration](./project-configuration.md)) |
| `--model` flag (`-m`) | Highest-priority model override (applies to both standard and quick-update subcommands) |
| `.saaga/config.yaml` `model` field | Fallback model override for standard subcommands when `--model` is not provided |
| `.saaga/config.yaml` `quickModel` field | Fallback model override for `quick-update` subcommand when `--model` is not provided |

**How to access:**

- `resolveBackend(input)` — resolves the backend name from `--backend` flag → `config.backend` → error
- `defaultModelFor(backend)` — returns the default model for a backend (used by standard subcommands)
- `defaultQuickModelFor(backend)` — returns the default quick model for a backend (used by `quick-update`)
- `createAgent(opts)` — constructs a concrete `Agent` instance from the resolved backend, model, and CI flag

### Backend Resolution Precedence

```
--backend flag  →  .saaga/config.yaml backend  →  BackendError
     ↓                       ↓                            ↓
 validate against        validate against           "Backend must be specified
 ALLOWED_BACKENDS        ALLOWED_BACKENDS            via --backend flag or
                                                    .saaga/config.yaml"
```

Empty strings are treated as absent — an empty `--backend ""` or an empty `config.backend` value is ignored.

### Model Resolution Precedence

For standard subcommands (`init`, `update`, `verify-quick-updates`):
```
--model flag  →  config.model  →  defaultModelFor(backend)
```

For the `quick-update` subcommand (uses a cheaper/faster model by default):
```
--model flag  →  config.quickModel  →  defaultQuickModelFor(backend)
```

## Data Storage

| Type | Field/Property | Purpose |
|------|----------------|---------|
| `Backend` | (type alias) | String union: `"cursor" \| "copilot" \| "claude"` |
| `ResolveBackendInput` | `flag` | Optional `--backend` value from CLI flags |
| `ResolveBackendInput` | `config` | Optional `config.backend` string from `.saaga/config.yaml` |
| `CreateAgentOptions` | `backend` | Resolved `Backend` value |
| `CreateAgentOptions` | `model` | Resolved model string |
| `CreateAgentOptions` | `ci` | Optional CI mode flag (affects agent output format) |

### Internal Constants (not exported)

| Constant | Purpose |
|----------|---------|
| `ALLOWED_BACKENDS` | Readonly array `["cursor", "copilot", "claude"]` used for validation |
| `DEFAULT_MODELS` | Maps each backend to its default model: `cursor` → `"claude-4.6-opus-high-thinking"`, `copilot` → `"claude-sonnet-4.5"`, `claude` → `"opus"` |
| `DEFAULT_QUICK_MODELS` | Maps each backend to its default quick model: `cursor` → `"claude-4.6-sonnet-medium-thinking"`, `copilot` → `"claude-sonnet-4.5"`, `claude` → `"sonnet"` |

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/cli/backend.ts` | `resolveBackend()` | Resolve backend from `--backend` flag → `config.backend` → error |
| `src/cli/backend.ts` | `defaultModelFor()` | Return the default AI model string for a given backend (standard subcommands) |
| `src/cli/backend.ts` | `defaultQuickModelFor()` | Return the default quick AI model string for a given backend (`quick-update` subcommand) |
| `src/cli/backend.ts` | `createAgent()` | Construct a `CursorAgent`, `CopilotAgent`, or `ClaudeAgent` for the resolved backend |
| `src/cli/backend.ts` | `BackendError` (class) | Error class thrown for backend resolution failures |
| `src/cli/backend.ts` | `Backend` (type) | String union type: `"cursor" \| "copilot" \| "claude"` |
| `src/cli/backend.ts` | `ResolveBackendInput` (interface) | Input shape for `resolveBackend()` |
| `src/cli/backend.ts` | `CreateAgentOptions` (interface) | Input shape for `createAgent()` |

## Internal Implementation

- `resolveAgent()` in `src/cli.ts` — orchestrates the full resolution sequence: if `CliOptions.agent` is provided (test mode), returns it directly; otherwise calls `resolveBackend()` with the config → resolves model (using `config.quickModel` / `defaultQuickModelFor()` when `useQuickModel` is true, or `config.model` / `defaultModelFor()` otherwise) → `createAgent()`. Accepts a `config` parameter of type `SaagaConfig`. Not exported.

## Error Handling

| Scenario | Error |
|----------|-------|
| Neither `--backend` nor `config.backend` provided | `BackendError: "Backend must be specified via --backend flag or .saaga/config.yaml"` |
| Invalid backend value (not `cursor`, `copilot`, or `claude`) | `BackendError: "Invalid backend: <name> (must be 'cursor', 'copilot', or 'claude')"` |

## Reference Implementations

- `src/cli/backend.ts` — the canonical module containing all resolution, validation, and construction logic
- `tests/cli/backend.test.ts` — comprehensive test suite covering flag precedence, config fallback, empty values, and unknown backends

## Related Concepts

- [Project Configuration](./project-configuration.md) — how `.saaga/config.yaml` provides fallback values for backend, model, and quick model
- [Agent Interface](./agent-interface.md) — the `Agent` contract that backends implement
- [Run Context and Isolation](./run-context.md) — how the resolved agent is paired with a run directory
