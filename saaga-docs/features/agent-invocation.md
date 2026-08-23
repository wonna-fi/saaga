# Feature: Agent Invocation

## Overview

Agent invocation is the process by which Saaga resolves which AI agent backend to use, constructs a concrete agent instance, renders a prompt from a template, and executes the agent. This is the central mechanism that connects every agent step in a flow to an external AI coding CLI. Agents now run in one of two execution modes: unrestricted (legacy) or restricted (profile-based), with the flow engine passing permission profiles and audit callbacks through to each backend.

## Key Concepts

Before working with this feature, understand these concepts:

- [Agent Interface](../concepts/agent-interface.md)
- [Agent Permissions and Restriction](../concepts/agent-permissions.md)
- [Agent Events and Denial Parsing](../concepts/agent-events.md)
- [Templates and Prompt Rendering](../concepts/templates-and-prompt-rendering.md)
- [Package Paths](../concepts/package-paths.md)

## Functional Specification

### User Flow

1. User runs a flow via CLI (e.g., `saaga run init <dir> --backend cursor`)
2. The CLI resolves which backend to use via the precedence chain:
   - `--backend` flag (highest priority)
   - `.saaga/config.yaml` `defaultBackend` field (fallback)
   - Error if neither is set
3. The CLI resolves the AI model via a model key (`high` for `init`/`update`/`verify-quick-updates`, `medium` for `quick-update`):
   - `--model <key>=<model>` CLI overrides (highest priority per key)
   - `.saaga/config.yaml` `backends.<backend>.models.<key>` (fallback)
   - Built-in per-backend defaults for `low`/`medium`/`high` only: high — `cursor` → `claude-4.6-opus-high-thinking`, `copilot` → `claude-sonnet-4.6`, `claude` → `opus`; medium — `cursor` → `cursor-grok-4.5-high`, `copilot` → `claude-sonnet-4.6`, `claude` → `sonnet`
4. A concrete `Agent` instance is constructed (`CursorAgent`, `CopilotAgent`, or `ClaudeAgent`)
5. A permission profile is built via `buildProfile()` (unless `--dangerously-allow-all` is passed, which skips the profile entirely). The profile is written to `permissions.json` in the run directory
6. If `--audit-permissions` is set, a `PermissionAuditor` is created to collect denial events during the run
7. The flow engine iterates through steps; for each `agent` step:
   a. The prompt template path is resolved: `<PROMPTS_DIR>/<step.prompt>.md`
   b. Step `vars` are interpolated against the flow scope (`${var}` expressions)
   c. The prompt file is rendered with `renderPromptFile()` (`{var}` placeholders)
   d. Pre-loaded `.saagarules` content is appended via `appendSaagaRules()` when `deps.saagaRules` is set
   e. `Agent.run(prompt, { cwd, additionalDirs, permissions, logFile, echo, onEvent })` is called — `additionalDirs` is constructed from `scope.run_dir`, `permissions` and `onEvent` (from auditor) are forwarded from `RunFlowDeps`, `logFile` and `echo` are forwarded from `RunFlowDeps`
   f. If `exitCode !== 0`, the runner throws `AgentStepFailedError` (after printing the last lines from the log file)
   g. If `expect_file` is declared, the runner verifies the file exists on disk

### Execution Modes

| Mode | When | Backend Behavior |
|------|------|-----------------|
| Unrestricted | `--dangerously-allow-all` or `permissions` absent | Backend uses legacy flags: `--force` (Cursor), `--allow-all-tools` (Copilot), `--dangerously-skip-permissions` (Claude) |
| Restricted | Default (profile present) | Backend translates `AgentPermissions` into native permission rules: deny lists (Cursor), tool whitelists (Copilot), settings JSON (Claude) |

### Backend Permission Translation

| Backend | Restricted Mode Mechanism | Shell Policy |
|---------|--------------------------|--------------|
| Cursor | `--trust` flag + `cli-config.json` with deny rules under `<runDir>/.cursor-cli/`; `CURSOR_CONFIG_DIR` env override | `read-only-git`: `allow` entries for git subcommands |
| Copilot | `--available-tools view,create,edit,glob,grep` + `--disallow-temp-dir` + `--allow-all-tools` | `none`: shell is removed entirely (no middle ground between bash and no shell) |
| Claude | `--permission-mode dontAsk` + `--settings` JSON with `allow`/`deny`/`additionalDirectories` + `--strict-mcp-config` | `none`: `Bash` tool denied (deny rule defeats any narrower allow) |

### Precedence Chain (Backend Resolution)

```
--backend flag  →  .saaga/config.yaml  →  BackendError
     ↓                     ↓                       ↓
 validate against      validate against       "Backend must be specified
 ALLOWED_BACKENDS      ALLOWED_BACKENDS        via --backend flag or
                                              .saaga/config.yaml"
```

### Precedence Chain (Model Resolution)

Each model key is resolved independently (`high` for most flow subcommands, `medium` for `quick-update`):
```
--model <key>=<model>  →  config.backends.<backend>.models.<key>  →  resolveModel(backend, key, models)
```
(`resolveModel` falls back to built-in defaults for `low`/`medium`/`high` only; custom keys require a configured value.)
### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Neither `--backend` flag nor `.saaga/config.yaml` backend configured | Throws `BackendError: "Backend must be specified via --backend flag or .saaga/config.yaml"` |
| Invalid backend name | Throws `BackendError: "Invalid backend: <name> (must be 'cursor', 'copilot', or 'claude')"` |
| `--dangerously-allow-all` flag | Skips permission profile construction; `permissions` is `undefined` in `RunFlowDeps`, so backends use unrestricted mode |
| Agent exits with non-zero code | Throws `AgentStepFailedError: "Agent step '<prompt>' exited with code <N>"` |
| `expect_file` declared but file missing after agent run | Throws `ExpectFileMissingError: "Agent step '<prompt>' did not produce expect_file: <path>"` |
| Prompt template file not found | Throws `TemplateFileNotFoundError: "Prompt template not found: <path>"` |
| Agent binary not found (spawn failure) | All adapters catch the error and return `{ exitCode: 1 }` |
| Test mode: `CliOptions.agent` provided | Skips backend resolution entirely; uses the provided agent directly |

## Technical Implementation

### Resolution Flow (in `src/cli.ts`)

The internal `resolveAgent()` function orchestrates the resolution:

1. If `options.agent` is provided (test mode), return it directly
2. Otherwise: `resolveBackend()` → determine model → `createAgent()`

### Agent Step Execution (in `src/engine/runner.ts`)

The internal `runAgentStep()` function handles each agent step:

1. Resolve prompt path: `resolve(PROMPTS_DIR, step.prompt + ".md")`
2. Interpolate `step.vars` values through `interpolate()` (flow expression engine)
3. Call `renderPromptFile(promptPath, renderedVars)` to produce the final prompt string
4. Call `appendSaagaRules(prompt, deps.saagaRules)` to append project-specific documentation instructions when loaded
5. Ensure directories exist for any rendered vars or `expect_file` paths that fall under `run_dir`
6. Construct `additionalDirs` from `scope.run_dir` (if it is a string)
7. Call `deps.agent.run(prompt, { cwd: deps.cwd, additionalDirs, permissions: deps.permissions, logFile: deps.logFile, echo: deps.verbose, onEvent })` — `onEvent` is derived from `deps.auditor`: when present, it wraps `auditor.record()` as the sink
8. Check `result.exitCode !== 0` → throw `AgentStepFailedError` (after printing the last lines from the log file via `printFailureTail()`)
9. If `step.expect_file` is set, interpolate the path and verify the file exists

### RunFlowDeps Interface

| Field | Type | Purpose |
|-------|------|---------|
| `agent` | `Agent` | The concrete agent instance |
| `cwd` | `string` | Working directory |
| `scripts` | `ScriptRegistry` (optional) | Registry of built-in scripts |
| `logger` | `Logger` (optional) | Logger for phase/detail output |
| `logFile` | `string` (optional) | Path to the run log file |
| `verbose` | `boolean` (optional) | Mirror agent output to terminal |
| `permissions` | `AgentPermissions` (optional) | Permission profile for agent steps; absent means unrestricted |
| `auditor` | `PermissionAuditor` (optional) | Collects and classifies denial events; its presence switches agent steps to structured JSON output |
| `saagaRules` | `string` (optional) | Pre-loaded `.saagarules` content snapshot appended to every agent prompt |

### Services/Functions

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/cli.ts` | `runCli()` | CLI entry point — parses args, dispatches to subcommands |
| `src/cli/backend.ts` | `resolveBackend()` | Resolve backend name from flag → config → error |
| `src/cli/backend.ts` | `resolveModel()` | Return the model string for a model key (merged map → built-in default → error) |
| `src/cli/backend.ts` | `createAgent()` | Construct a `CursorAgent`, `CopilotAgent`, or `ClaudeAgent` |
| `src/cli/backend.ts` | `BackendError` (class) | Error for backend resolution failures |
| `src/engine/runner.ts` | `runFlow()` | Execute a flow definition — iterates steps, dispatches by type |
| `src/engine/runner.ts` | `RunFlowDeps` (interface) | Dependencies for flow execution, including `permissions`, `auditor`, and `saagaRules` |
| `src/engine/runner.ts` | `AgentStepFailedError` (class) | Error for non-zero agent exit codes |
| `src/engine/runner.ts` | `ExpectFileMissingError` (class) | Error when `expect_file` is not produced |
| `src/templates.ts` | `renderPromptFile()` | Read and render a prompt template file |
| `src/saaga-rules.ts` | `appendSaagaRules()` | Append `.saagarules` content to a rendered prompt |
| `src/agent/permissions.ts` | `buildProfile()` | Build the default restricted permission profile from app path, docs dir, run dir, and optional extra dirs |
| `src/agent/audit.ts` | `PermissionAuditor` (class) | Collect denial events and produce a classified summary |

### Internal Implementation

| Module | Function | Purpose |
|--------|----------|---------|
| `src/cli.ts` | `resolveAgent()` | Orchestrates backend resolution, model selection, and agent construction (not exported) |
| `src/cli.ts` | `runFlowSubcommand()` | Shared logic for `saaga run <flow>` (not exported) |
| `src/engine/runner.ts` | `runAgentStep()` | Renders prompt, appends `saagaRules`, and invokes agent for a single step, forwarding `permissions` and `onEvent` (not exported) |
| `src/engine/runner.ts` | `assertFileExists()` | Checks `expect_file` existence (not exported) |

## Integration Points

- **Depends on**: Agent backend CLIs (`cursor-agent`, `copilot`, `claude`), prompt templates in `prompts/`, flow YAML definitions in `flows/`, permission profile from `src/agent/permissions.ts`, event system from `src/agent/events.ts`
- **Used by**: `saaga run <flow>` for bundled flows (`init`, `update`, `quick-update`, `verify-quick-updates`) — every invocation except `install-rules` and `doctor` resolves an agent and executes a flow containing agent steps
- **External systems**: External agent CLI binaries invoked via `execa`

## Extension Guide

- **Add a new backend**: follow the [Adding Agent Backends](../patterns/adding-agent-backends.md) pattern — backends must now handle both unrestricted and restricted modes
- **Add a new prompt**: follow the [Creating Prompt Templates](../patterns/creating-prompt-templates.md) pattern
- **Modify model defaults**: edit the `DEFAULT_BACKEND_MODELS` record in `src/cli/backend.ts`
- **Credential handling**: backends handle their own authentication; Saaga does not manage credential env vars
- **Adjust permission profile**: modify `buildProfile()` in `src/agent/permissions.ts` to change read/write roots, deny paths, or shell policy
