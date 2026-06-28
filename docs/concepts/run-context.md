# Run Context and Isolation

## Business Definition

A run context provides a unique identifier and a dedicated directory for each Saaga invocation. This ensures that artifacts produced by different runs (plans, review files, status outputs) are isolated from one another. The run ID encodes the application name, subcommand, timestamp, and a random hex suffix to guarantee uniqueness.

## Configuration

| Source | Description |
|--------|-------------|
| `SAAGA_DIR` env var | Overrides the base directory for run storage (default: `$HOME/.saaga`) |
| `HOME` env var | Fallback for determining the base directory when `SAAGA_DIR` is not set |

**How to access:**

- `createRunContext(input)` — generates a run ID, creates the run directory on disk, and returns a `RunContext` object

### Run Directory Resolution

```
SAAGA_DIR env var  →  $HOME/.saaga  →  Error
        ↓                       ↓                 ↓
  use as base dir      resolve ~/.saaga   "Cannot determine run directory:
                                               HOME is not set and
                                               SAAGA_DIR is not provided"
```

### Run ID Format

The run ID follows the pattern: `<app>-<subcommand>-<YYYYMMDD>-<HHMMSS>-<8 hex chars>`

Examples:
- `salesforce-init-20260516-105303-2f498e6e`
- `myapp-update-20260515-140022-a1b2c3d4`
- `acme-slice-1-20260516-090000-deadbeef`

The 8-hex-char suffix is generated from `crypto.randomBytes(4)`, ensuring uniqueness even when two runs occur within the same second.

### Run Directory Layout

```
$SAAGA_DIR/           (or $HOME/.saaga/)
  runs/
    <run-id>/             ← created by createRunContext()
      plans/              ← created by flow steps (e.g., plan-init agent step)
      slice-<N>/          ← created for slice subcommand outputs
        review-<iter>.md  ← verify/fix review output
        status-<iter>.txt ← verify/fix status ("PASS" or "FAIL")
```

## Data Storage

| Type | Field/Property | Purpose |
|------|----------------|---------|
| `CreateRunContextInput` | `app` | Application display name (used as the run-id prefix) |
| `CreateRunContextInput` | `subcommand` | Subcommand label embedded in the run-id (e.g., `init`, `update`, `slice-1`) |
| `CreateRunContextInput` | `appPath` | Optional absolute path to the application directory; surfaced as `${app_path}` in flow scope |
| `CreateRunContextInput` | `env` | Process env for reading `HOME` and `SAAGA_DIR` (defaults to `process.env`) |
| `CreateRunContextInput` | `now` | Optional `Date` override for the timestamp portion (used by tests) |
| `RunContext` | `app` | Application display name |
| `RunContext` | `appPath` | Optional absolute application directory path |
| `RunContext` | `subcommand` | Subcommand label |
| `RunContext` | `runId` | Generated unique run identifier |
| `RunContext` | `runDir` | Absolute path to the created run directory |
| `RunContext` | `date` | Date portion of the run timestamp, formatted as YYYYMMDD |

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/run-context.ts` | `createRunContext()` | Generate a unique run ID, create the run directory on disk, and return a `RunContext` |
| `src/run-context.ts` | `CreateRunContextInput` (interface) | Input shape for `createRunContext()` |
| `src/run-context.ts` | `RunContext` (interface) | Output shape containing `runId`, `runDir`, and metadata |

## Internal Implementation

- `formatTimestamp()` in `src/run-context.ts` — formats a `Date` as `YYYYMMDD-HHMMSS` (not exported)
- `formatDate()` in `src/run-context.ts` — formats a `Date` as `YYYYMMDD` for the `date` field (not exported)
- `resolveSaagaDir()` in `src/cli.ts` — resolves `SAAGA_DIR` or falls back to `$HOME/.saaga`; returns `null` if neither is set (not exported)
- `deriveRunDirFromPlanPath()` in `src/cli.ts` — checks whether a plan file path lives under `<saagaDir>/runs/<id>/<anything>` (any path under a run directory) and extracts the run ID and directory if so, allowing the `slice` subcommand to reuse an existing run context (not exported)

## Slice Subcommand: Run Directory Derivation

The `slice` subcommand has special behavior: if the plan file path matches the layout `<SAAGA_DIR>/runs/<id>/<anything>` (any path under a run directory), the run directory is derived from the existing path rather than creating a new one. This allows `slice` invocations to write outputs (review files, status files) alongside the original plan.

When the plan path is outside this layout, a fresh run context is created using `createRunContext()`.

## Error Handling

| Scenario | Error |
|----------|-------|
| Neither `HOME` nor `SAAGA_DIR` is set | `Error: "Cannot determine run directory: HOME is not set and SAAGA_DIR is not provided"` |

## Reference Implementations

- `src/run-context.ts` — the canonical module for run ID generation and directory creation
- `tests/run-context.test.ts` — tests for ID format, directory placement, `SAAGA_DIR` override, directory creation, uniqueness, and returned context fields

## Related Concepts

- [Backend Resolution](./backend-resolution.md) — how the agent is resolved before the run context is created
- [Flow DSL](./flow-dsl.md) — how `run_id` and `run_dir` are injected into flow scope
