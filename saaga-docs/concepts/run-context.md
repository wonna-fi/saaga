# Run Context and Isolation

## Business Definition

A run context provides a unique identifier and a dedicated directory for each Saaga invocation. This ensures that artifacts produced by different runs (plans, review files, status outputs) are isolated from one another. The run ID encodes the application name, subcommand, timestamp, and a random hex suffix to guarantee uniqueness. Run directories are stored inside the application being documented (under `.saaga-runs/`), keeping all run artifacts co-located with the project.

## Configuration

| Source | Description |
|--------|-------------|
| `appPath` parameter | Required absolute path to the application directory; the run directory is created at `<appPath>/.saaga-runs/<run-id>/` |

**How to access:**

- `createRunContext(input)` — generates a run ID, creates the run directory on disk, and returns a `RunContext` object

### Run Directory Resolution

The run directory is deterministically resolved from the application path:

```
<appPath>/.saaga-runs/<run-id>/
```

No environment variables are consulted. The `appPath` field is required — if not provided, `createRunContext()` cannot construct a run directory.

### Run ID Format

The run ID follows the pattern: `<app>-<subcommand>-<YYYYMMDD>-<HHMMSS>-<8 hex chars>`

Examples:
- `salesforce-init-20260516-105303-2f498e6e`
- `myapp-update-20260515-140022-a1b2c3d4`

The 8-hex-char suffix is generated from `crypto.randomBytes(4)`, ensuring uniqueness even when two runs occur within the same second.

### Run Directory Layout

```
<appPath>/
  .saaga-runs/                    ← gitignored by ensure-gitignore script
    <run-id>/                     ← created by createRunContext()
      plans/                      ← created by flow steps (e.g., plan-init agent step)
      run.log                     ← agent output log
      permissions.json            ← permission profile snapshot
      permission-audit.log        ← denial audit (when --audit-permissions is used)
```

## Data Storage

| Type | Field/Property | Purpose |
|------|----------------|---------|
| `CreateRunContextInput` | `app` | Application display name (used as the run-id prefix) |
| `CreateRunContextInput` | `subcommand` | Subcommand label embedded in the run-id (e.g., `init`, `update`, `slice-1`) |
| `CreateRunContextInput` | `appPath` | Required absolute path to the application directory; the base for `.saaga-runs/` |
| `CreateRunContextInput` | `now` | Optional `Date` override for the timestamp portion (used by tests) |
| `RunContext` | `app` | Application display name |
| `RunContext` | `appPath` | Absolute application directory path |
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

## Reference Implementations

- `src/run-context.ts` — the canonical module for run ID generation and directory creation
- `tests/run-context.test.ts` — tests for ID format, directory placement, directory creation, uniqueness, and returned context fields

## Related Concepts

- [Backend Resolution](./backend-resolution.md) — how the agent is resolved before the run context is created
- [Flow DSL](./flow-dsl.md) — how `run_id` and `run_dir` are injected into flow scope
