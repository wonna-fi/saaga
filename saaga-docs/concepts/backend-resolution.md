---
title: Backend Resolution
type: concept
sources:
  - src/cli/backend.ts
  - src/model-keys.ts
  - src/cli.ts
  - src/run-manifest.ts
  - src/doctor/index.ts
terms:
  - backend
  - model key
  - MODEL_KEY_PATTERN
  - fast tier
last_verified: 2026-10-05
---

# Backend Resolution

## Business Definition

Which coding-agent CLI a run drives, and which model stands behind each named model slot
its flow asks for. Both are decided once, before the run starts, so a typo or a missing
model fails immediately instead of part-way through a flow that has already paid for
agent calls.

A **backend** is one of `cursor`, `copilot`, `claude`, `kiro` or `codex` — the `Backend` union, and
the only values `--backend` and `defaultBackend` accept; see
[adding agent backends](../patterns/adding-agent-backends.md) to extend it. A **model key** is a name a flow step
uses to ask for a class of model rather than a specific one: `low`, `medium` and `high`
are built in and have per-backend defaults, and any other key must be supplied by the
user. `MODEL_KEY_PATTERN` (`/^[a-z][a-z0-9_-]*$/`) is the whole rule for a valid key, and
`DEFAULT_MODEL_KEY` (`medium`) is the key a step gets when its YAML omits `model:`.

## Configuration

| Source | Precedence | Description |
|--------|------------|-------------|
| `--backend <name>` | 1 (highest) | The backend for this invocation |
| Resumed run's manifest `backend` | 2 | Keeps a resumed run on its original backend unless the flag overrides it |
| `defaultBackend` in [`.saaga/config.yaml`](./project-configuration.md) | 3 | The project's usual backend |
| — | — | With none of the three set, `resolveBackend()` throws `BackendError` |

| Source | Precedence | Description |
|--------|------------|-------------|
| `--model <key>=<model>` | 1 (highest) | Repeatable; overrides one key and leaves the rest intact |
| Resumed run's manifest `models` | 2 | Reapplied only when the resolved backend matches the run's |
| `backends.<backend>.models.<key>` in config | 3 | The project's model per key for that backend |
| `DEFAULT_BACKEND_MODELS` | 4 | Built-in per-backend model for `low`, `medium` and `high` only |

An empty value counts as absent at every layer except `--model`, where `--model high=` is
rejected outright as an invalid flag value. A key with nothing behind it after all
four layers throws `BackendError` listing the keys that *are* available and both ways to
supply the missing one. The keys to resolve are the flow's own and only those — each agent
step's `model:`, or `DEFAULT_MODEL_KEY` where it omits one — so the cost notice never
advertises a model the run will not use; the agent also carries one base model, resolved
separately from `DEFAULT_MODEL_KEY`, for calls that name no key.

Only a `codex` run resolves a **fast tier** (codex's `fast` service tier, billed at a higher
rate); for any other backend it stays unset, and either flag is [an error](../features/cli-entry-point.md).
`saaga doctor` uses the same order minus the manifest layer.

| Source | Precedence | Description |
|--------|------------|-------------|
| `--fast` / `--no-fast` | 1 (highest) | Turns the tier on or off for this invocation |
| Resumed run's manifest `fast` | 2 | Reapplied only when the resolved backend matches the run's, like `models` |
| `backends.codex.fast` in config | 3 | The project's standing choice; `false` when unset |

**How to access:**
- `resolveBackend({ flag, config })` - the `Backend`, or `BackendError`
- `resolveModels(backend, keys, models)` - key-to-model map for every key a flow asks for
- `createAgent({ backend, model, ci, fast })` - the concrete [`Agent`](./agent-interface.md)
- `backendCliCommand(backend)` - the CLI binary name Saaga will execute
- `BUILTIN_MODEL_KEYS` (constant) - the three keys with built-in defaults
- `DEFAULT_MODEL_KEY` (constant) - the key applied when a step omits `model:`
- `MODEL_KEY_PATTERN` (constant) - the regular expression a model key must match

## Data Storage

| Artifact | Field/Property | Purpose |
|--------|-------|---------|
| `run.json` | `backend` | The backend the run resolved to, re-read when it is resumed |
| `run.json` | `models` | Every key the run's flow asked for, pinned to the model it resolved to |
| `run.json` | `fast` | The resolved codex tier; rewritten on every resume, so a run moved to another backend drops it |

Pinning every key — including the ones that came from built-in defaults — is what keeps a
half-finished run internally consistent when the config, or Saaga itself, changes between
attempts. See [run context](./run-context.md) for the manifest as a whole.

## Key Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `cli/backend` | `Backend`, `ModelKey`, `BuiltinModelKey` | The backend union and the model-key type |
| `cli/backend` | `resolveBackend()` | Flag, then config, then error |
| `cli/backend` | `parseModelOverrides()` | Parses repeatable `<key>=<model>` flag values into a map |
| `cli/backend` | `mergeModelOverrides()` | Layers overrides over configured models, per key, without mutating either |
| `cli/backend` | `resolveModel()` | The model behind one key, or `BackendError` |
| `cli/backend` | `resolveModels()` | Resolves every key a flow asks for, up front and deduplicated |
| `cli/backend` | `backendCliCommand()` | Backend to CLI binary: `cursor-agent`, `copilot`, `claude`, `kiro-cli`, `codex` |
| `cli/backend` | `createAgent()` | Backend to `CursorAgent`, `CopilotAgent`, `ClaudeAgent`, `KiroAgent` or `CodexAgent`; only `CodexAgent` takes `fast`, which selects codex's `fast` service tier |
| `cli/backend` | `ALLOWED_BACKENDS` | The accepted backend names, checked by `resolveBackend()` |
| `cli/backend` | `BackendError` | Thrown for an invalid backend, `--model` value, or unresolvable key |
| `model-keys` | `isValidModelKey()` | Whether a string matches `MODEL_KEY_PATTERN` |

`model-keys` is a leaf module, so the flow engine validates a step's `model:` without importing
the concrete backends; `cli/backend` re-exports its three symbols for existing importers.

## Internal Implementation

> - `cli/backend.DEFAULT_BACKEND_MODELS` - the per-backend default for each built-in key. Read
>   the values from the module: they track what each provider currently offers. Kiro's are
>   models every kiro plan offers, never `auto`, which would pick per task and break reproducibility.
> - `cli/backend.resolveModel()` - guards every lookup with `typeof`, because
>   `noUncheckedIndexedAccess` is off and an inherited key such as `constructor` satisfies
>   `MODEL_KEY_PATTERN`, which an unguarded lookup would answer with a function.

## Reference Implementations

- `src/cli/backend.ts` - the whole resolution path, from flag string to `Agent`
- `cli.resolveAgent()` - the caller that layers config, resumed pins and flags in order
  and hands the resolved map to the cost notice, the manifest and the runner (`src/cli.ts`)
- `tests/cli/backend.test.ts` - precedence and error cases, key by key
- `tests/cli/model-wiring.test.ts` - the resolved map reaching an agent step
- `tests/cli/codex-options.test.ts` - the fast tier from config, flags and a resumed run

## Related Concepts

- [Project Configuration](./project-configuration.md)
- [Agent Interface](./agent-interface.md)
- [Feature: Doctor](../features/doctor.md) — how a backend's availability is established
- [Feature: CLI Entry Point](../features/cli-entry-point.md)
