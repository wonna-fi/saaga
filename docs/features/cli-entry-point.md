# Feature: CLI Entry Point

## Overview

The `saaga` CLI is the main user-facing entry point for generating and maintaining domain documentation. It provides five subcommands — `init`, `install-rules`, `update`, `quick-update`, and `verify-quick-updates`. Most subcommands resolve an AI agent backend, create an isolated run context, load a flow YAML file, and execute it. The `install-rules` subcommand is an exception: it is a deterministic local file operation that requires no agent backend. The CLI is built with Commander and designed for both interactive and CI usage.

## Key Concepts

Before working with this feature, understand these concepts:

- [Backend Resolution](../concepts/backend-resolution.md) — how the agent backend is selected and the model resolved
- [Run Context and Isolation](../concepts/run-context.md) — how run IDs and directories are generated
- [Agent Interface](../concepts/agent-interface.md) — the `Agent` contract that backends implement
- [Flow DSL](../concepts/flow-dsl.md) — the step types and scope model used by flows

## Functional Specification

### Subcommands

| Subcommand | Arguments | Flow File | Description |
|------------|-----------|-----------|-------------|
| `init` | `[dir]` | `flows/init.flow.yaml` | Generate full initial documentation (architecture → plan → slices → baseline); accepts `--rule-targets` flag |
| `install-rules` | `[dir]` | _(no flow — direct script)_ | Install documentation rule stubs (no agent backend required); accepts `--rule-targets` flag |
| `update` | `[dir]` | `flows/update.flow.yaml` | Incrementally update documentation based on changes since BASELINE |
| `quick-update` | `[dir]` | `flows/quick-update.flow.yaml` | Fast single-session doc update using a cheaper model; produces a quick-update metadata artifact |
| `verify-quick-updates` | `[dir]` | `flows/verify-quick-updates.flow.yaml` | Verify, correct, and consolidate all unverified quick-update artifacts |

### Global Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--backend <name>` | `-b` | Agent backend (`cursor`, `copilot`, or `claude`) |
| `--model <name>` | `-m` | AI model override (defaults per-backend) |
| `--ci` | — | CI mode: plain (non-color) log output |
| `--version` | `-v` | Print version and exit |
| `--help` | `-h` | Print help and exit |

### User Flow: install-rules Subcommand

1. User runs `saaga install-rules [dir] [--rule-targets <targets>]` (dir defaults to the current working directory)
2. CLI validates the `dir` argument (must exist and be a directory)
3. CLI loads config via `loadConfig(appPath)` (see [Project Configuration](../concepts/project-configuration.md))
4. CLI resolves rule targets from `--rule-targets` flag → `config.ruleTargets` → default `"agentsmd"` via `resolveRuleTargets()`
5. CLI calls `installRules()` directly (no backend resolution, no run context)
6. For each rule target: installs the rule stub (rendered from `rules/rule-stub.md`). Targets `agentsmd` and `claude` use managed-block markers (`<!-- saaga:begin --> … <!-- saaga:end -->`) for upsert into shared files. Targets `cursor` and `copilot` write a full owned file from their respective templates (`rules/cursor-rule.mdc` and `rules/copilot-rule.md`)

### User Flow: Standard Subcommands (init, update, verify-quick-updates)

1. User runs `saaga <subcommand> [dir] [flags]` (dir defaults to the current working directory)
2. CLI validates the `dir` argument:
   - Must exist on disk (otherwise: `Error: "Directory not found: <dir>"`)
   - Must be a directory (otherwise: `Error: "Not a directory: <dir>"`)
3. CLI loads config via `loadConfig(appPath)` (see [Project Configuration](../concepts/project-configuration.md))
4. CLI extracts the app name as `basename(appPath)` and resolves the agent via the backend resolution chain, passing config (see [Backend Resolution](../concepts/backend-resolution.md))
5. CLI creates a run context: generates a unique run ID and creates the run directory on disk (see [Run Context and Isolation](../concepts/run-context.md))
6. CLI creates a `Logger` (via internal `createLogger()`) and logs startup info: `saaga <subcommand> <path> (backend=<name>)` with optional conditional segment `, model=<model>` only when `--model` is explicitly provided. Also logs run ID and run directory.
7. CLI loads the flow definition: `loadFlow(flowName)` reads `flows/<flowName>.flow.yaml`
8. CLI executes the flow: `runFlow(flow, initialScope, deps)` with scope `{ app, app_path, run_id, run_dir, date }`, passing the logger in `RunFlowDeps`

### User Flow: quick-update Subcommand

The `quick-update` subcommand follows the same flow as standard subcommands (steps 1–8 above) with one difference: the agent is resolved using `config.quickModel` (from `.saaga/config.yaml`) or `defaultQuickModelFor(backend)` instead of the standard model. The `--model` flag overrides both.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Directory does not exist | Throws `Error: "Directory not found: <dir>"` |
| Path is not a directory | Throws `Error: "Not a directory: <dir>"` |
| No backend specified, no test agent | Throws `BackendError: "Backend must be specified via --backend flag or .saaga/config.yaml"` |
| Agent step exits with non-zero code | Throws `AgentStepFailedError`; CLI returns the exit code |
| `--version` flag | Prints `package.json` version string and exits with code 0 |
| `--help` flag | Prints help text listing all subcommands/flags and exits with code 0 |
| `CliOptions.agent` provided (test mode) | Skips backend resolution entirely |
| Invalid `--rule-targets` value | Throws `Error: install-rules: invalid rule target '<val>' (allowed: agentsmd, cursor, claude, copilot, none)` before any agent steps run |

## Technical Implementation

### Entry Point

The `src/cli.ts` module is the CLI entry point. When run directly (`process.argv[1]` matches the file), it invokes `runCli(process.argv.slice(2))` and calls `process.exit()` with the returned code. Unhandled errors are caught and printed to stderr with `[ERROR]` prefix.

### Version Resolution

The version is read from `package.json` at `PACKAGE_ROOT`. If the file cannot be read or parsed, the version defaults to `"0.0.0"`.

### Error Handling Strategy

The program uses Commander's `exitOverride()` to prevent Commander from calling `process.exit()` directly. Instead:

- `AgentStepFailedError` is caught and its `exitCode` is returned
- Commander info exits (version/help display) are detected by their error codes (`commander.version`, `commander.helpDisplayed`) and return 0
- All other errors propagate to the caller

### Services/Functions

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/cli.ts` | `runCli()` | CLI entry point — parses args, dispatches to subcommand handlers, returns exit code |
| `src/cli.ts` | `CliOptions` (interface) | Options for `runCli()`: optional `agent`, `cwd`, `env`, `stdout`, `stderr` overrides |
| `src/cli/config.ts` | `loadConfig()` | Load project config from `.saaga/config.yaml`; returns `SaagaConfig` |
| `src/cli/config.ts` | `SaagaConfig` (interface) | Shape of the parsed config: `backend?`, `model?`, `quickModel?`, `ruleTargets?` |
| `src/cli/config.ts` | `ConfigError` (class) | Error for malformed config YAML or invalid field types |
| `src/cli/backend.ts` | `resolveBackend()` | Resolve backend name from flag → config → error |
| `src/cli/backend.ts` | `defaultModelFor()` | Return the default model for a backend (standard subcommands) |
| `src/cli/backend.ts` | `defaultQuickModelFor()` | Return the default quick model for a backend (`quick-update` subcommand) |
| `src/cli/backend.ts` | `createAgent()` | Construct a `CursorAgent`, `CopilotAgent`, or `ClaudeAgent` |
| `src/cli/backend.ts` | `BackendError` (class) | Error for backend resolution failures |
| `src/run-context.ts` | `createRunContext()` | Generate run ID and create run directory |
| `src/engine/loader.ts` | `loadFlow()` | Load and parse a flow YAML file |
| `src/engine/runner.ts` | `runFlow()` | Execute a flow definition with scope and deps |
| `src/engine/runner.ts` | `AgentStepFailedError` (class) | Error for non-zero agent exit codes |
| `src/logger.ts` | `Logger` (class) | Structured leveled logger used for CLI startup info and flow progress output |

### Internal Implementation

| Module | Function | Purpose |
|--------|----------|---------|
| `src/cli.ts` | `readPackageVersion()` | Read version from `package.json` (not exported) |
| `src/cli.ts` | `isCommanderInfoExit()` | Detect Commander version/help exit codes (not exported) |
| `src/cli.ts` | `resolveAgent()` | Orchestrate backend resolution → model selection (standard or quick) → agent construction (not exported) |
| `src/cli.ts` | `runFlowSubcommand()` | Shared handler for `init`, `update`, `quick-update`, `verify-quick-updates`: validates dir, creates run context, executes flow (not exported) |
| `src/cli.ts` | `runInstallRulesSubcommand()` | Handler for `install-rules`: validates dir, calls `installRules()` directly without backend/run context (not exported) |
| `src/cli.ts` | `resolveRuleTargets()` | Resolves effective rule targets from CLI flag → `config.ruleTargets` → default `"agentsmd"`, then validates via `parseRuleTargets()` (not exported) |
| `src/cli.ts` | `createLogger()` | Creates a `Logger` with `ci` from global flags and `stream` from CLI options (defaults to `process.stderr`) (not exported) |

## Integration Points

- **Depends on**: Agent backends (`cursor-agent`, `copilot` CLIs), flow YAML definitions in `flows/`, prompt templates in `prompts/`, built-in scripts
- **Used by**: End users running Saaga from the command line or CI/CD pipelines
- **External systems**: External agent CLI binaries invoked via the resolved `Agent` implementation

## Extension Guide

- **Add a new subcommand**: follow the [Adding CLI Subcommands](../patterns/adding-cli-subcommands.md) pattern
- **Add a new backend**: follow the [Adding Agent Backends](../patterns/adding-agent-backends.md) pattern
- **Test with FakeAgent**: follow the [Testing with FakeAgent](../patterns/testing-with-fake-agent.md) pattern
- **Add global flags**: add `.option()` calls to the program root in `src/cli.ts` and extend the `GlobalCliFlags` interface
- **Add subcommand-specific flags**: add `.option()` calls to the specific command and access via `cmd.opts()`
