---
title: Backend Resolution
type: concept
sources:
  - src/cli/backend.ts
  - src/model-keys.ts
  - src/cli.ts
  - src/run-manifest.ts
terms:
  - backend
  - model key
  - MODEL_KEY_PATTERN
---

# Backend Resolution

## Business Definition

Which coding-agent CLI a run drives, and which model stands behind each named model slot
its flow asks for. Both are decided once, before the run starts, so a typo or a missing
model fails immediately instead of part-way through a flow that has already paid for
agent calls.

A **backend** is one of `cursor`, `copilot` or `claude` — the `Backend` union, and the
only values `--backend` and `defaultBackend` accept. A **model key** is a name a flow step
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
supply the missing one.

The keys to resolve are the flow's own and only those — the `model:` of each agent step,
or `DEFAULT_MODEL_KEY` where the step omits it — so the cost notice never advertises a
model the run will not use. The constructed agent additionally carries one base model,
resolved separately from `DEFAULT_MODEL_KEY`, used whenever a call does not name a key.

**How to access:**
- `resolveBackend({ flag, config })` - the `Backend`, or `BackendError`
- `resolveModels(backend, keys, models)` - key-to-model map for every key a flow asks for
- `createAgent({ backend, model, ci })` - the concrete [`Agent`](./agent-interface.md)
- `backendCliCommand(backend)` - the CLI binary name Saaga will execute
- `BUILTIN_MODEL_KEYS` (constant) - the three keys with built-in defaults
- `DEFAULT_MODEL_KEY` (constant) - the key applied when a step omits `model:`
- `MODEL_KEY_PATTERN` (constant) - the regular expression a model key must match

## Data Storage

| Artifact | Field/Property | Purpose |
|--------|-------|---------|
| `run.json` | `backend` | The backend the run resolved to, re-read when it is resumed |
| `run.json` | `models` | Every key the run's flow asked for, pinned to the model it resolved to |

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
| `cli/backend` | `backendCliCommand()` | Backend to CLI binary: `cursor-agent`, `copilot`, `claude` |
| `cli/backend` | `createAgent()` | Backend to `CursorAgent`, `CopilotAgent` or `ClaudeAgent` |
| `cli/backend` | `BackendError` | Thrown for an invalid backend, `--model` value, or unresolvable key |
| `model-keys` | `isValidModelKey()` | Whether a string matches `MODEL_KEY_PATTERN` |

`model-keys` is a leaf module with no backend or agent imports, so the flow engine can
validate a step's `model:` key without pulling the concrete backends into its module
graph; `cli/backend` re-exports its three symbols for existing importers.

## Internal Implementation

> - `cli/backend.DEFAULT_BACKEND_MODELS` - the per-backend default for each built-in key.
>   Read the values from the module rather than from documentation: they track what each
>   provider currently offers and change without a Saaga release.
> - `cli/backend.resolveModel()` - guards every lookup with `typeof`, because
>   `noUncheckedIndexedAccess` is off and an inherited key such as `constructor` satisfies
>   `MODEL_KEY_PATTERN`, which an unguarded lookup would answer with a function.

## Reference Implementations

- `src/cli/backend.ts` - the whole resolution path, from flag string to `Agent`
- `cli.resolveAgent()` - the caller that layers config, resumed pins and flags in order
  and hands the resolved map to the cost notice, the manifest and the runner (`src/cli.ts`)
- `tests/cli/backend.test.ts` - precedence and error cases, key by key
- `tests/cli/model-wiring.test.ts` - the resolved map reaching an agent step

## Related Concepts

- [Project Configuration](./project-configuration.md)
- [Agent Interface](./agent-interface.md)
- [Feature: Doctor](../features/doctor.md) — how a backend's availability is established
- [Feature: CLI Entry Point](../features/cli-entry-point.md)
