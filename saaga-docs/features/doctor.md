# Feature: Doctor Diagnostic System

## Overview

The `doctor` command checks whether agent backend CLIs are installed, reachable, and functioning correctly under the restricted permission profile. It runs probe tests at two tiers — fast (no model calls) and full (real agent invocations in a disposable scratch repository) — and reports structured results. A lightweight preflight subsystem reuses fast-tier probes to gate flow execution before any agent calls are made.

## Key Concepts

Before working with this feature, understand these concepts:
- [Agent Interface](../concepts/agent-interface.md) — the `Agent` contract and `AgentRunOpts` that probes invoke
- [Agent Permissions](../concepts/agent-permissions.md) — the `AgentPermissions` profile that full-tier probes exercise

## Functional Specification

### User Flow

1. User runs `saaga doctor [--backend <name>] [--level full] [--json] [--probe <ids...>]`
2. If `--backend` is not specified, all three backends (`cursor`, `copilot`, `claude`) are checked
3. For each backend, the system checks CLI availability by looking up the binary on `PATH` and querying `--version`
4. If the backend is unavailable, it is reported as `NOT AVAILABLE` with a reason and no probes run
5. If available, probes applicable to the selected level and backend are executed:
   - **Fast tier** (default): runs the `version` probe (calls `<cli> --version`) and the `required-flags` probe (checks CLI `--help`/`-h` for every flag Saaga passes); skips probes that require model calls
   - **Full tier**: runs all fast probes plus the full-tier probes that invoke the real agent in a scratch repository
6. For full-tier runs, failed **capability** probes are retried up to twice under the same profile to filter LLM flakiness (`transient` if a retry passes). Persistent failures are **diagnosed** by rerunning without the permission profile to distinguish `policy-denial` (the profile is too restrictive) from `backend-failure` (the CLI or environment is at fault)
7. Results are formatted as human-readable colored output or versioned JSON (with `--json`)
8. The process exits with code 0 (all passed), 1 (at least one probe failed), or 2 (no backend available)

### CLI Registration

The `doctor` subcommand is registered on the root `saaga` program with these subcommand-specific options:

| Flag | Default | Description |
|------|---------|-------------|
| `--level <level>` | `fast` | Probe tier: `fast` (no model calls) or `full` (real agent invocations) |
| `--json` | off | Output results as versioned JSON (`schemaVersion: 1`) |
| `--probe <ids...>` | all | Run only the specified probe IDs (comma- or space-separated) |

The global `-b, --backend`, `--model`, and `--ci` flags also apply. When `--backend` is omitted, doctor defaults to `"all"` (unlike flow subcommands which require a backend). Doctor probes always use the **`low`** model key, so `--model low=<model>` is the relevant override for doctor.

### Probe Catalogue

Probes are defined as data in `PROBE_CATALOGUE`. Each probe has a stable `id` used by CI assertions and `--probe` filtering, a human-readable `description`, a `level` (`"fast"` or `"full"`), and an optional `backends` array scoping it to specific backends.

| Probe ID | Level | Backends | Kind | Description |
|----------|-------|----------|------|-------------|
| `version` | fast | all | capability | CLI answers a version query |
| `required-flags` | fast | all | capability | CLI help mentions every flag Saaga passes during agent runs |
| `unknown-model-fails` | fast | all | capability | Invoking with a bogus model returns non-zero exit |
| `handshake` | full | all | capability | Reply with a nonce; asserts exit 0 |
| `write-in-cwd` | full | all | capability | Create a file in the docs tree containing a nonce |
| `read-from-cwd` | full | all | capability | Copy a seeded nonce file to verify read path |
| `read-gitignored` | full | all | capability | Read a gitignored file to verify `.gitignore` workaround |
| `write-run-dir` | full | all | capability | Write into the `.saaga-runs/` run directory |
| `read-outside-workspace-denied` | full | all | restriction | Files outside the workspace are unreadable |
| `write-outside-workspace-denied` | full | all | restriction | Writes outside the workspace are refused |
| `arbitrary-shell-denied` | full | all | restriction | A non-git shell command cannot run |
| `write-source-denied` | full | cursor, claude | restriction | Writing to `src/` is refused |
| `rule-files-denied` | full | cursor, claude | restriction | `AGENTS.md` and rule files are unwritable |
| `baseline-denied` | full | cursor, claude | restriction | `BASELINE` file is unwritable |
| `restricted-shell-utility-allowed` | full | cursor, copilot, claude | capability | `pwd` runs under the restricted shell allowance |
| `read-only-git-allowed` | full | cursor, copilot, claude | capability | `git log` runs under the restricted shell allowance |
| `git-mutation-denied` | full | cursor, copilot, claude | restriction | `git commit` is refused |
| `claude/tool-surface` | full | claude | restriction | Only file tools and Bash are available (no web, subagents, MCP) |
| `claude/absolute-path-anchoring` | full | claude | capability | Double-slash absolute paths work in Edit rules |
| `claude/run-dir-writable` | full | claude | capability | The in-workspace run dir is writable |

### Probe Kinds: Capability vs Restriction

Full-tier probes have a `kind` field that determines failure diagnosis behavior:

- **`capability`** probes assert that something works under the restricted profile. When a capability probe fails:
  1. It is retried up to `CAPABILITY_RETRIES` (2) times under the same profile. If a retry passes, the result is `status: "pass"` with `classification: "transient"` and a `retries` count — not treated as a failure.
  2. If all retries fail, the system reruns the probe without the profile to determine classification:
     - `policy-denial`: succeeds unrestricted, so the profile is too tight
     - `backend-failure`: fails either way, so the CLI/environment is at fault
- **`restriction`** probes assert that something is correctly denied. These are never retried for flakiness and never rerun unrestricted (they are expected to succeed without restrictions).

### Exit Code Semantics

| Exit Code | Meaning |
|-----------|---------|
| `0` | All probes passed (or all were skipped) |
| `1` | At least one probe failed |
| `2` | No backend was available (could not run any probes) |

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| All probes filtered out by `--probe` | Exit code 0 (nothing to fail) |
| Backend binary on PATH but `--version` times out | Version recorded as `"unknown"`; backend still marked available |
| Full probe exceeds 120s timeout | Probe is aborted via `AbortController` and reported as a failure |
| `--json` with failures | JSON output is written to stdout; exit code is still non-zero |
| No backends available with `--backend all` | Exit code 2 with "Could not run probes" message |
| Comma-separated `--probe` IDs | Parsed correctly via `splitProbeIds()` (Commander only splits on spaces) |

## Technical Implementation

### Data Model

| Model/Type | Key Fields | Purpose |
|--------|------------|---------|
| `DoctorOptions` | `backend`, `level`, `json`, `probe`, `model`, `backendModels`, `ci`, `cwd` | Input options for `runDoctor()` |
| `DoctorResult` | `schemaVersion`, `backends`, `exitCode`, `logDir` | Top-level result container (schema version is always `1`) |
| `DoctorBackendResult` | `backend`, `available`, `reason`, `version`, `probes` | Per-backend availability and probe results |
| `ProbeDefinition` | `id`, `description`, `level`, `backends` | Static probe metadata in the catalogue |
| `ProbeRunResult` | `probeId`, `backend`, `status`, `classification`, `exitCode`, `elapsed`, `error`, `retries` | Runtime result of a single probe execution (`retries` set when a transient pass needed retries) |
| `ProbeLevel` | — | `"fast" \| "full"` |
| `ProbeClassification` | — | `"policy-denial" \| "backend-failure" \| "transient"` |
| `FullProbeRunOptions` | `backend`, `agent`, `filterIds`, `quiet`, `ci`, `logFile` | Options for the full-tier probe runner |
| `ScratchRepo` | `appDir`, `runDir`, `docsDir`, `buildNonce`, `srcNonce`, `outsideDir`, `outsideNonce`, `cleanup` | Isolated disposable repository for full-tier probes |
| `PreflightResult` | `passed`, `doctorResult` | Fast-tier check result for flow gating |

### Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `src/doctor/index.ts` | `runDoctor()` | Orchestrates the full doctor run: checks availability, runs probes at the selected tier, returns `DoctorResult` |
| `src/doctor/index.ts` | `formatDoctorResult()` | Formats a `DoctorResult` into human-readable colored (or plain) text output |
| `src/doctor/index.ts` | `DoctorOptions` (interface) | Input options shape for `runDoctor()` |
| `src/doctor/index.ts` | `DoctorResult` (interface) | Structured result: backends array, exit code, optional log directory |
| `src/doctor/index.ts` | `DoctorBackendResult` (interface) | Per-backend result: availability, version, probe results |
| `src/doctor/probes.ts` | `PROBE_CATALOGUE` (constant) | Static array of all probe definitions with stable IDs |
| `src/doctor/probes.ts` | `ProbeDefinition` (interface) | Shape of a probe definition: id, description, level, optional backend scope |
| `src/doctor/probes.ts` | `ProbeRunResult` (interface) | Shape of a probe execution result |
| `src/doctor/probes.ts` | `ProbeLevel` (type) | `"fast" \| "full"` |
| `src/doctor/probes.ts` | `ProbeClassification` (type) | `"policy-denial" \| "backend-failure" \| "transient"` |
| `src/doctor/required-flags.ts` | `REQUIRED_CLI_FLAGS` (constant) | Per-backend list of CLI flags Saaga passes during agent runs |
| `src/doctor/required-flags.ts` | `findMissingRequiredFlags()` | Return flags from `required` that do not appear as tokens in CLI help text |
| `src/doctor/full-probes.ts` | `runFullSideEffectProbes()` | Runs all full-tier probes in a scratch repo; creates and tears down the repo automatically |
| `src/doctor/full-probes.ts` | `FullProbeRunOptions` (interface) | Options for the full-tier runner |
| `src/doctor/scratch-repo.ts` | `createScratchRepo()` | Creates a temporary git repository with seeded files for probes |
| `src/doctor/scratch-repo.ts` | `ScratchRepo` (interface) | Handle to the scratch repo with paths, nonces, and a cleanup function |
| `src/doctor/preflight.ts` | `runPreflight()` | Runs fast-tier probes for a single backend; returns whether it passed |
| `src/doctor/preflight.ts` | `PreflightResult` (interface) | Result shape: `passed` boolean and the underlying `DoctorResult` |

### Scratch Repository Lifecycle

Full-tier probes run inside a disposable scratch repository to avoid side effects on the real workspace:

1. `createScratchRepo()` creates a temporary directory under `os.tmpdir()` with the structure:
   - `app/` — simulated application root (the `appDir`)
   - `app/src/index.ts` — seeded with a random nonce for read probes
   - `app/build/generated.txt` — gitignored file with a nonce for gitignore probes
   - `app/saaga-docs/` — docs directory for write probes
   - `app/AGENTS.md` — rule file for restriction probes
   - `app/saaga-docs/BASELINE` — baseline file for restriction probes
   - `app/.saaga-runs/<probe-run-id>/` — simulated run directory
   - `outside/` — directory outside `appDir` for escape probes, containing `secret.txt`
2. The directory is initialized as a git repo with an `initial` commit
3. A restricted permission profile is built via `buildProfile()` scoped to the scratch repo
4. Probes run sequentially against the scratch repo
5. `scratch.cleanup()` removes the entire temporary tree in a `finally` block

### Diagnosis Flow for Failed Capability Probes

When a full-tier capability probe fails under the restricted profile:

1. The probe is retried up to 2 times (`CAPABILITY_RETRIES`) under the same profile
2. If any retry **passes**: reported as `status: "pass"` with `classification: "transient"` and `retries` set to the retry count that succeeded — not a failure
3. If all retries fail, the probe is rerun with `permissions: undefined` (unrestricted):
   - If the unrestricted run **passes**: classified as `policy-denial` — the permission profile is too tight for this backend/CLI version
   - If the unrestricted run **fails**: classified as `backend-failure` — the CLI, credentials, or environment is at fault
4. Restriction probes are never retried for flakiness and never diagnosed (they are expected to pass unrestricted)

### Probe Model Selection

Full-tier probes require a model for agent invocations. Doctor always uses the **`low`** model key. The model is selected in order of precedence:

1. CLI `--model low=<model>` override (folded into `DoctorOptions.modelOverrides`)
2. `backends.<backend>.models.low` from `.saaga/config.yaml` (passed via `DoctorOptions.backendModels`)
3. Built-in low-key defaults: `composer-2.5` (cursor), `claude-haiku-4.5` (copilot), `haiku` (claude)

### Log Files

When running at the `full` level, a timestamped log directory is created at `<cwd>/.saaga-runs/doctor/<timestamp>/`. Each backend gets a log file (`<backend>.log`) containing raw agent output. The log directory path is included in both the formatted output and the JSON result.

### Preflight Integration

Before any flow subcommand (`init`, `update`, `quick-update`, `verify-quick-updates`) executes, the CLI runs `runPreflight()` for the resolved backend:

1. `runPreflight(backend)` calls `runDoctor({ backend, level: "fast" })`
2. If `doctorResult.exitCode !== 0`, preflight has failed
3. The CLI writes a message to stderr directing the user to run `saaga doctor --backend <name>` for details
4. A `PreflightError` is thrown, which the CLI catches and exits with code 1
5. If the agent was injected via `CliOptions.agent` (test mode), preflight is skipped

## Integration Points

- **Depends on**: [Agent Interface](../concepts/agent-interface.md) (full probes invoke `Agent.run()`), [Agent Permissions](../concepts/agent-permissions.md) (`buildProfile()` creates the restricted profile for probes)
- **Used by**: [CLI Entry Point](./cli-entry-point.md) (the `doctor` subcommand and preflight gating in flow subcommands)
- **External systems**: Backend CLI binaries (`cursor`, `copilot`, `claude`) — doctor checks their availability and exercises their restricted-mode behavior

## Extension Guide

### Adding a New Probe

1. Add a `ProbeDefinition` entry to `PROBE_CATALOGUE` in `src/doctor/probes.ts` with a stable `id`, descriptive `description`, appropriate `level`, and optional `backends` scope
2. For fast-tier probes: add handling in the `runFastProbes()` function in `src/doctor/index.ts`
3. For full-tier probes: add a `FullProbe` entry to the `FULL_PROBES` array in `src/doctor/full-probes.ts` with:
   - `id` matching the catalogue entry
   - `kind`: `"capability"` (asserts something works) or `"restriction"` (asserts something is denied)
   - `buildPrompt(ctx)`: returns the prompt string for the agent
   - `assert(exitCode, ctx, events)`: throws if the probe's assertion fails
4. If the probe needs event parsing, set `wantsEvents: true` — the probe runner will collect `AgentEvent` objects and pass them to `assert()`
5. For backend-specific probes, set `backends` to limit which backends the probe applies to

### Adding a New Backend

When a new agent backend is added to Saaga, extend the doctor system:

1. Ensure the backend's CLI binary name is returned by `backendCliCommand()` (already required by the agent interface)
2. Add the backend's built-in model defaults to `DEFAULT_BACKEND_MODELS` in `src/cli/backend.ts` (doctor uses the `low` key entry)
3. Add the flags Saaga passes for that backend to `REQUIRED_CLI_FLAGS` in `src/doctor/required-flags.ts`
4. Add the backend's bogus-model CLI arguments to `runUnknownModelProbe()` in `src/doctor/index.ts`
5. Review existing full-tier probes — most are backend-agnostic, but some may need `backends` scoping adjustments
