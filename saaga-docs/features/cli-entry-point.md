# Feature: CLI Entry Point

## Overview

The `saaga` CLI is the main user-facing entry point for generating and maintaining domain documentation. It provides three top-level subcommands — `run`, `install-rules`, and `doctor`. Bundled documentation flows (`init`, `update`, `quick-update`, `verify-quick-updates`) are invoked as `saaga run <flow> [dir]`. Omitting the flow name lists available flows with their optional YAML `description` fields. The `install-rules` subcommand is a deterministic local file operation that requires no agent backend. The `doctor` subcommand checks backend health without executing a flow. Former top-level flow commands (`saaga init`, etc.) remain as hidden stubs that exit with a migration message pointing to `saaga run <flow>`. The CLI is built with Commander and designed for both interactive and CI usage.

## Key Concepts

Before working with this feature, understand these concepts:

- [Backend Resolution](../concepts/backend-resolution.md) — how the agent backend is selected and the model resolved
- [Run Context and Isolation](../concepts/run-context.md) — how run IDs and directories are generated
- [Agent Interface](../concepts/agent-interface.md) — the `Agent` contract that backends implement
- [Agent Permissions](../concepts/agent-permissions.md) — the permission profile that restricts agent access
- [Cost Confirmation](../concepts/cost-confirmation.md) — the interactive cost disclaimer shown before agent-backed commands
- [Unstable Features](../concepts/unstable-features.md) — opt-in experimental feature flags
- [Saaga Rules](../concepts/saaga-rules.md) — project-root `.saagarules` instructions appended to agent prompts
- [Flow DSL](../concepts/flow-dsl.md) — the step types and scope model used by flows

## Functional Specification

### Subcommands

| Subcommand | Arguments | Flow File | Description |
|------------|-----------|-----------|-------------|
| `run` | `[flow] [dir]` | `flows/<flow>.flow.yaml` | Run a named bundled flow; omit `flow` to list available flows (name + description). `--rule-targets` applies when running `init` |
| `install-rules` | `[dir]` | _(no flow — direct script)_ | Install documentation rule stubs (no agent backend required); accepts `--rule-targets` flag |
| `doctor` | — | _(no flow — direct execution)_ | Check backend CLI availability and capability probes; see [Doctor Diagnostic System](./doctor.md) |

#### Bundled flows (via `saaga run`)

| Flow | File | Description |
|------|------|-------------|
| `init` | `flows/init.flow.yaml` | Generate full initial documentation (architecture → plan → slices → baseline) |
| `update` | `flows/update.flow.yaml` | Incrementally update documentation based on changes since BASELINE |
| `quick-update` | `flows/quick-update.flow.yaml` | Fast single-session doc update using a cheaper model; produces a quick-update metadata artifact |
| `verify-quick-updates` | `flows/verify-quick-updates.flow.yaml` | Verify, correct, and consolidate all unverified quick-update artifacts |

### Global Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--backend <name>` | `-b` | Agent backend (`cursor`, `copilot`, or `claude`) |
| `--model <key>=<model>` | — | Set the model for a model key (repeatable), e.g. `--model high=opus`; built-in keys are `low` (doctor), `medium` (quick-update), `high` (init/update/verify-quick-updates) |
| `--ci` | — | CI mode: plain (non-color) log output |
| `--verbose` | — | Show detailed step output and live agent output on terminal |
| `--yes` | `-y` | Skip the cost confirmation prompt for agent-backed commands |
| `--allow-dir <path>` | — | Grant additional read/write access to a directory (repeatable) |
| `--unstable-feature <name>` | — | Enable an unstable feature (repeatable; see [Unstable Features](../concepts/unstable-features.md)) |
| `--dangerously-allow-all` | — | Run without permission restrictions (reproduces legacy behavior) |
| `--audit-permissions` | — | Scan agent output for permission denials and log a summary |
| `--version` | `-v` | Print version and exit |
| `--help` | `-h` | Print help and exit |

### User Flow: install-rules Subcommand

1. User runs `saaga install-rules [dir] [--rule-targets <targets>]` (dir defaults to the current working directory)
2. CLI validates the `dir` argument (must exist and be a directory)
3. CLI bootstraps unstable features via `bootstrapUnstableFeatures()` (loads config, validates `--unstable-feature`, initializes the registry, may warn) and reuses the returned config
4. CLI resolves rule targets from `--rule-targets` flag → `config.ruleTargets` → default `"agentsmd"` via `resolveRuleTargets()`
5. CLI calls `installRules()` directly (no backend resolution, no run context)
6. For each rule target: installs the rule stub (rendered from `rules/rule-stub.md`). Targets `agentsmd` and `claude` use managed-block markers (`<!-- saaga:begin --> … <!-- saaga:end -->`) for upsert into shared files. Targets `cursor` and `copilot` write a full owned file from their respective templates (`rules/cursor-rule.mdc` and `rules/copilot-rule.md`)

### User Flow: `saaga run` (flow execution)

1. User runs `saaga run` with no flow name → CLI calls `listFlows()`, prints each flow name and optional `description`, prints usage `saaga run <flow> [dir]`, and exits 0
2. User runs `saaga run <flow> [dir] [flags]` (dir defaults to the current working directory)
3. If the flow name is unknown, CLI calls `flowExists(flow)` / `listFlows()` and throws `Error: Unknown flow '<flow>'. Available flows: …`
4. CLI validates the `dir` argument:
   - Must exist on disk (otherwise: `Error: "Directory not found: <dir>"`)
   - Must be a directory (otherwise: `Error: "Not a directory: <dir>"`)
5. CLI bootstraps unstable features via `bootstrapUnstableFeatures()` (loads config, validates CLI feature names, initializes the process-wide registry, emits `[WARN]` when any are enabled) and reuses the returned config
6. CLI extracts the app name as `basename(appPath)` and resolves the agent via the backend resolution chain, passing config (see [Backend Resolution](../concepts/backend-resolution.md)). Flow `quick-update` uses the **`medium`** model key; all other flows use **`high`**
7. CLI calls `confirmAgentCosts()` with the resolved backend/model info, the `--yes` flag, `config.autoApprove`, `--ci` mode, and stdin/stderr streams. The cost notice names the invocation as `saaga run <flow>`. If the user declines, throws `ConfirmationDeclinedError` (see [Cost Confirmation](../concepts/cost-confirmation.md))
8. CLI runs a preflight check via `runPreflight(backend)` — verifies the backend CLI is available and functioning. If it fails, writes a message to stderr and throws `PreflightError`. Skipped when a test agent is injected via `CliOptions.agent`.
9. CLI creates the run context: generates a unique run ID (embedding the flow name as the subcommand label) and creates the run directory at `<appPath>/.saaga-runs/<run-id>/` (see [Run Context and Isolation](../concepts/run-context.md))
10. CLI creates a log file path: `logFile = resolve(runCtx.runDir, "run.log")`
11. CLI resolves `verbose` from `globals.verbose ?? false`
12. CLI creates a `Logger` via internal `createLogger(globals, options, logFile)` — passes `ci`, `stream`, `logFile`, and `verbose` to `LoggerOptions`
13. Logger logs startup info: `saaga run <flow> <path> (backend=<name>, model=<model>)` when a model was resolved (omits the model segment when the agent was injected via `CliOptions.agent`). Also logs run ID and run directory. Logs `buildCostSummary()` as a detail line.
14. CLI resolves the effective documentation directory via `resolveDocsDir(config)` (falls back to `DEFAULT_DOCS_DIR` = `"saaga-docs"`)
15. CLI constructs the permission profile:
    - If `--dangerously-allow-all` is set: skips profile construction, writes a warning to stderr, and `permissions` remains `undefined`
    - Otherwise: calls `buildProfile({ appPath, docsDir, runDir, allowDirs })` to produce an `AgentPermissions` profile (see [Agent Permissions](../concepts/agent-permissions.md))
    - Writes `permissions.json` to the run directory (records mode `"restricted"` or `"unrestricted"` and the profile)
16. CLI checks for a legacy `docs/` directory: if `config.docsDir` is not set, `docs/BASELINE` exists, and `<docsDir>/BASELINE` does not exist, it logs a warning suggesting the user set `docsDir: docs` in `.saaga/config.yaml` or migrate contents
17. CLI creates a `PermissionAuditor` if `--audit-permissions` is set and a permission profile exists. The auditor collects denial events and writes a report to `<runDir>/permission-audit.log` after the flow completes. If `--audit-permissions` is set without a profile (i.e., with `--dangerously-allow-all`), a warning is logged and the flag is ignored.
18. CLI loads `.saagarules` via `loadSaagaRules(appPath)` (see [Saaga Rules](../concepts/saaga-rules.md)); missing/empty yields `undefined`
19. CLI loads the flow definition: `loadFlow(flowName)` reads `flows/<flowName>.flow.yaml`
20. CLI executes the flow: `runFlow(flow, initialScope, deps)` with scope `{ app, app_path, docs_dir, run_id, run_dir, date }` (plus `rule_targets` when provided for `init`) and deps `{ agent, cwd: appPath, logger, logFile, verbose, permissions, auditor, saagaRules }`
21. After flow completion (in a `finally` block): if an auditor is active, calls `reportAudit()` which flushes the audit log and surfaces unexpected denials as warnings
22. CLI calls `logger.dispose()` to clean up spinner intervals

### User Flow: doctor Subcommand

1. User runs `saaga doctor [--backend <name>] [--level fast|full] [--json] [--probe <ids...>]`
2. CLI bootstraps unstable features for the cwd (same as other subcommands) and loads config
3. CLI resolves `backend` from `--backend` flag or defaults to `"all"` (checks all backends)
4. CLI constructs `DoctorOptions`: `{ backend, level, json, probe, modelOverrides: parseModelOverrides(globals.model), backendModels: config.backends, ci }`
5. CLI calls `runDoctor(doctorOpts)` — runs probes at the specified level and returns a `DoctorResult`
6. If `--json` is set, writes the result as formatted JSON to stdout; otherwise writes human-readable output via `formatDoctorResult()`
7. If `result.exitCode !== 0`, throws `DoctorError` (exit code 1 = probes failed, 2 = probes could not run)

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Directory does not exist | Throws `Error: "Directory not found: <dir>"` |
| Path is not a directory | Throws `Error: "Not a directory: <dir>"` |
| No backend specified, no test agent | Throws `BackendError: "Backend must be specified via --backend flag or .saaga/config.yaml"` |
| Agent step exits with non-zero code | Throws `AgentStepFailedError`; CLI returns the exit code |
| `--version` flag | Prints `package.json` version string and exits with code 0 |
| `--help` flag | Prints help text listing all subcommands/flags and exits with code 0 |
| `CliOptions.agent` provided (test mode) | Skips backend resolution and preflight check entirely |
| Invalid `--rule-targets` value | Throws `Error: install-rules: invalid rule target '<val>' (allowed: agentsmd, cursor, claude, copilot, none)` before any agent steps run |
| Unknown `--unstable-feature` value | Throws `UnstableFeatureError`; CLI writes `[ERROR]` and returns exit code 1 |
| User declines cost confirmation | `ConfirmationDeclinedError`: exits with code 1, prints `"aborted: cost confirmation declined"` to stderr |
| Non-interactive terminal (piped stdin, `--ci`) | Cost notice printed, continues without waiting for confirmation |
| `--yes` flag or `autoApprove: true` | Cost notice printed with `"Confirmation auto-approved."`, continues without prompting |
| Preflight check fails | Throws `PreflightError`; CLI returns exit code 1 with a message to run `saaga doctor` for details |
| `--dangerously-allow-all` set | Agent runs without permission restrictions; a warning is printed to stderr |
| `--audit-permissions` without a profile | Warning logged; flag has no effect |
| Doctor probes fail | Throws `DoctorError`; exit code 1 (failed) or 2 (could not run) |
| Unknown flow name to `saaga run` | Throws `Error: Unknown flow '<flow>'. Available flows: …` |
| Legacy top-level flow command (`saaga init`, etc.) | Throws `DeprecatedCommandError` with message `'saaga <cmd>' has moved — use: saaga run <cmd>`; exit code 1 |

## Technical Implementation

### Entry Point

The `src/cli.ts` module is the CLI entry point. When run directly (`process.argv[1]` matches the file), it invokes `runCli(process.argv.slice(2))` and calls `process.exit()` with the returned code. Unhandled errors are caught and printed to stderr with `[ERROR]` prefix.

### Version Resolution

The version is read from `package.json` at `PACKAGE_ROOT`. If the file cannot be read or parsed, the version defaults to `"0.0.0"`.

### Error Handling Strategy

The program uses Commander's `exitOverride()` to prevent Commander from calling `process.exit()` directly. Instead:

- `AgentStepFailedError` is caught and its `exitCode` is returned
- `ConfirmationDeclinedError` is caught, its message is written to stderr, and its `exitCode` (1) is returned
- `UnstableFeatureError` is caught, its message is written to stderr with `[ERROR]` prefix, and its `exitCode` (1) is returned
- `DoctorError` is caught and its `exitCode` (1 or 2) is returned
- `PreflightError` is caught and its `exitCode` (1) is returned
- `DeprecatedCommandError` is caught, its migration message is written to stderr, and its `exitCode` (1) is returned
- Commander info exits (version/help display) are detected by their error codes (`commander.version`, `commander.helpDisplayed`) and return 0
- All other errors propagate to the caller

### Services/Functions

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/cli.ts` | `runCli()` | CLI entry point — parses args, dispatches to subcommand handlers, returns exit code |
| `src/cli.ts` | `CliOptions` (interface) | Options for `runCli()`: optional `agent`, `cwd`, `stdout`, `stderr`, `stdin` overrides |
| `src/cli/config.ts` | `loadConfig()` | Load project config from `.saaga/config.yaml`; returns `SaagaConfig` |
| `src/cli/config.ts` | `SaagaConfig` (interface) | Shape of the parsed config: `defaultBackend?`, `backends?`, `ruleTargets?`, `docsDir?`, `autoApprove?`, `unstableFeatures?` |
| `src/cli/config.ts` | `DEFAULT_DOCS_DIR` (constant) | Default documentation directory name: `"saaga-docs"` |
| `src/cli/config.ts` | `ConfigError` (class) | Error for malformed config YAML or invalid field types |
| `src/saaga-rules.ts` | `loadSaagaRules()` | Load and validate `.saagarules` from the app root |
| `src/unstable-features.ts` | `initUnstableFeatures()` | Initialize the process-wide unstable feature set |
| `src/unstable-features.ts` | `UNSTABLE_FEATURES` (constant) | Known unstable feature names |
| `src/cli/backend.ts` | `resolveBackend()` | Resolve backend name from flag → config → error |
| `src/cli/backend.ts` | `resolveModel()` | Return the model string for a model key; consults merged models map then built-in defaults |
| `src/cli/backend.ts` | `parseModelOverrides()` | Parse repeatable `--model <key>=<model>` CLI values into a map |
| `src/cli/backend.ts` | `mergeModelOverrides()` | Merge config models with CLI overrides (CLI wins per key) |
| `src/cli/backend.ts` | `ModelKey` / `BuiltinModelKey` (types) | Model key string; built-in keys are `"low" \| "medium" \| "high"` |
| `src/cli/backend.ts` | `createAgent()` | Construct a `CursorAgent`, `CopilotAgent`, or `ClaudeAgent` |
| `src/cli/backend.ts` | `backendCliCommand()` | Return the CLI binary name for a given backend |
| `src/cli/backend.ts` | `BackendError` (class) | Error for backend resolution failures |
| `src/cli/confirm.ts` | `confirmAgentCosts()` | Show cost disclaimer, prompt for confirmation, throw `ConfirmationDeclinedError` on decline |
| `src/cli/confirm.ts` | `buildCostNotice()` | Build the multi-line cost notice string |
| `src/cli/confirm.ts` | `buildCostSummary()` | Build a one-line cost summary string for log output |
| `src/cli/confirm.ts` | `ConfirmationDeclinedError` (class) | Error thrown when the user declines cost confirmation |
| `src/cli/confirm.ts` | `CostNoticeInput` (interface) | Input shape for `buildCostNotice()` and `buildCostSummary()` |
| `src/cli/confirm.ts` | `CostConfirmationInput` (interface) | Extended input shape for `confirmAgentCosts()` |
| `src/run-context.ts` | `createRunContext()` | Generate run ID and create run directory |
| `src/engine/loader.ts` | `loadFlow()` | Load and parse a flow YAML file |
| `src/engine/loader.ts` | `listFlows()` | List bundled flows as sorted `FlowInfo[]` (name + optional description) for `saaga run` listing |
| `src/engine/loader.ts` | `flowExists()` | Check whether a named flow file exists under `FLOWS_DIR` |
| `src/engine/runner.ts` | `runFlow()` | Execute a flow definition with scope and deps |
| `src/engine/runner.ts` | `AgentStepFailedError` (class) | Error for non-zero agent exit codes |
| `src/agent/permissions.ts` | `buildProfile()` | Constructs an `AgentPermissions` profile from app path, docs dir, run dir, and extra allow-dirs |
| `src/agent/audit.ts` | `PermissionAuditor` (class) | Collects denial events during a run and writes a classified audit log |
| `src/doctor/index.ts` | `runDoctor()` | Executes doctor probes at the specified level and returns `DoctorResult` |
| `src/doctor/index.ts` | `formatDoctorResult()` | Formats a `DoctorResult` for human-readable terminal output |
| `src/doctor/preflight.ts` | `runPreflight()` | Runs fast-tier probes to verify backend availability before flow execution |
| `src/logger.ts` | `Logger` (class) | Facade over `OutputSink`: provides `info()`, `warn()`, `error()`, `phaseBegin()`, `phaseEnd()`, `phaseImmediate()`, `detail()`, `dispose()` for CLI and flow progress output |

### Internal Implementation

| Module | Function | Purpose |
|--------|----------|---------|
| `src/cli.ts` | `readPackageVersion()` | Read version from `package.json` (not exported) |
| `src/cli.ts` | `isCommanderInfoExit()` | Detect Commander version/help exit codes (not exported) |
| `src/cli.ts` | `bootstrapUnstableFeatures()` | Validates dir, loads config, resolves/initializes unstable features, emits enablement warning; returns config (not exported) |
| `src/cli.ts` | `UnstableFeatureError` (class) | Error thrown for unknown `--unstable-feature` names (exit code 1) (not exported) |
| `src/cli.ts` | `resolveAgent()` | Orchestrate backend resolution → model key selection (`medium` for quick-update, `high` otherwise) → `mergeModelOverrides` + `resolveModel()` → agent construction; returns `ResolvedAgent` (with optional `backend` and `model` fields) (not exported) |
| `src/cli/confirm.ts` | `isInteractive()` | Determines if the terminal supports interactive prompt by checking `--ci`, stdin existence, and `isTTY` (not exported) |
| `src/cli.ts` | `runFlowSubcommand()` | Shared handler for `saaga run <flow>`: validates dir, creates run context, executes flow (not exported) |
| `src/cli.ts` | `DeprecatedCommandError` (class) | Error thrown by hidden legacy flow command stubs; points users to `saaga run <flow>` (exit code 1) (not exported) |
| `src/cli.ts` | `runInstallRulesSubcommand()` | Handler for `install-rules`: validates dir, calls `installRules()` directly without backend/run context (not exported) |
| `src/cli.ts` | `resolveRuleTargets()` | Resolves effective rule targets from CLI flag → `config.ruleTargets` → default `"agentsmd"`, then validates via `parseRuleTargets()` (not exported) |
| `src/cli.ts` | `resolveDocsDir()` | Resolves effective docs directory from `config.docsDir` → `DEFAULT_DOCS_DIR` (`"saaga-docs"`) (not exported) |
| `src/cli.ts` | `isFile()` | Checks whether a path exists as a file (used for legacy `docs/BASELINE` migration warning) (not exported) |
| `src/cli.ts` | `createLogger()` | Creates a `Logger` with `ci` from global flags, `stream` from CLI options (defaults to `process.stderr`), `logFile`, and `verbose` from global flags (not exported) |
| `src/cli.ts` | `reportAudit()` | Flushes the `PermissionAuditor` and surfaces unexpected denials as warnings (not exported) |
| `src/cli.ts` | `splitProbeIds()` | Splits comma- or space-separated probe IDs for the doctor `--probe` flag (not exported) |
| `src/cli.ts` | `PreflightError` (class) | Error thrown when the preflight check fails (not exported) |
| `src/cli.ts` | `DoctorError` (class) | Error thrown when doctor probes fail or cannot run (not exported) |

## Integration Points

- **Depends on**: Agent backends (`cursor-agent`, `copilot` CLIs), flow YAML definitions in `flows/`, prompt templates in `prompts/`, built-in scripts
- **Used by**: End users running Saaga from the command line or CI/CD pipelines
- **External systems**: External agent CLI binaries invoked via the resolved `Agent` implementation

## Extension Guide

- **Add a bundled flow**: follow the [Adding CLI Subcommands](../patterns/adding-cli-subcommands.md) pattern (prefer `flows/*.flow.yaml` + `saaga run`)
- **Add a non-flow top-level command**: same pattern's non-flow section
- **Add a new backend**: follow the [Adding Agent Backends](../patterns/adding-agent-backends.md) pattern
- **Test with FakeAgent**: follow the [Testing with FakeAgent](../patterns/testing-with-fake-agent.md) pattern
- **Add global flags**: add `.option()` calls to the program root in `src/cli.ts` and extend the `GlobalCliFlags` interface
- **Add subcommand-specific flags**: add `.option()` calls to the specific command and access via `cmd.opts()`
