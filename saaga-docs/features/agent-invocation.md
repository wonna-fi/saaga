# Feature: Agent Invocation

## Overview

Agent invocation is the process by which Saaga resolves which AI agent backend to use, constructs a concrete agent instance, renders a prompt from a template, and executes the agent. This is the central mechanism that connects every agent step in a flow to an external AI coding CLI.

## Key Concepts

Before working with this feature, understand these concepts:

- [Agent Interface](../concepts/agent-interface.md)
- [Templates and Prompt Rendering](../concepts/templates-and-prompt-rendering.md)
- [Package Paths](../concepts/package-paths.md)

## Functional Specification

### User Flow

1. User runs a CLI subcommand (e.g., `saaga init <dir> --backend cursor`)
2. The CLI resolves which backend to use via the precedence chain:
   - `--backend` flag (highest priority)
   - `SAAGA_BACKEND` env var (fallback)
   - Error if neither is set
3. The CLI resolves the AI model via:
   - `--model` flag (highest priority)
   - `AGENT_MODEL` env var (fallback)
   - Per-backend default: `cursor` → `claude-4.6-opus-high-thinking`, `copilot` → `claude-sonnet-4.5`, `claude` → `opus`
4. A concrete `Agent` instance is constructed (`CursorAgent`, `CopilotAgent`, or `ClaudeAgent`)
5. The flow engine iterates through steps; for each `agent` step:
   a. The prompt template path is resolved: `<PROMPTS_DIR>/<step.prompt>.md`
   b. Step `vars` are interpolated against the flow scope (`${var}` expressions)
   c. The prompt file is rendered with `renderPromptFile()` (`{var}` placeholders)
   d. `Agent.run(prompt, { cwd })` is called
   e. If `exitCode !== 0`, the runner throws `AgentStepFailedError`
   f. If `expect_file` is declared, the runner verifies the file exists on disk

### Precedence Chain (Backend Resolution)

```
--backend flag  →  SAAGA_BACKEND env var  →  BackendError
     ↓                     ↓                         ↓
 validate against      validate against         "Backend must be specified
 ALLOWED_BACKENDS      ALLOWED_BACKENDS          via --backend flag or
                                                 SAAGA_BACKEND env var"
```

### Precedence Chain (Model Resolution)

```
--model flag  →  AGENT_MODEL env var  →  defaultModelFor(backend)
```

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Neither `--backend` nor `SAAGA_BACKEND` set | Throws `BackendError: "Backend must be specified via --backend flag or SAAGA_BACKEND env var"` |
| Invalid backend name | Throws `BackendError: "Invalid backend: <name> (must be 'cursor', 'copilot', or 'claude')"` |
| Agent exits with non-zero code | Throws `AgentStepFailedError: "Agent step '<prompt>' exited with code <N>"` |
| `expect_file` declared but file missing after agent run | Throws `ExpectFileMissingError: "Agent step '<prompt>' did not produce expect_file: <path>"` |
| Prompt template file not found | Throws `TemplateFileNotFoundError: "Prompt template not found: <path>"` |
| Agent binary not found (spawn failure) | `CursorAgent` catches the error and returns `{ exitCode: 1 }` |
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
4. Call `deps.agent.run(prompt, { cwd: deps.cwd })` to invoke the agent
5. Check `result.exitCode !== 0` → throw `AgentStepFailedError`
6. If `step.expect_file` is set, interpolate the path and verify the file exists

### Services/Functions

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/cli.ts` | `runCli()` | CLI entry point — parses args, dispatches to subcommands |
| `src/cli/backend.ts` | `resolveBackend()` | Resolve backend name from flag → env → error |
| `src/cli/backend.ts` | `defaultModelFor()` | Return the default model string for a backend |
| `src/cli/backend.ts` | `createAgent()` | Construct a `CursorAgent`, `CopilotAgent`, or `ClaudeAgent` |
| `src/cli/backend.ts` | `BackendError` (class) | Error for backend resolution failures |
| `src/engine/runner.ts` | `runFlow()` | Execute a flow definition — iterates steps, dispatches by type |
| `src/engine/runner.ts` | `AgentStepFailedError` (class) | Error for non-zero agent exit codes |
| `src/engine/runner.ts` | `ExpectFileMissingError` (class) | Error when `expect_file` is not produced |
| `src/templates.ts` | `renderPromptFile()` | Read and render a prompt template file |

### Internal Implementation

| Module | Function | Purpose |
|--------|----------|---------|
| `src/cli.ts` | `resolveAgent()` | Orchestrates backend resolution, model selection, and agent construction (not exported) |
| `src/cli.ts` | `runFlowSubcommand()` | Shared logic for `init`, `update`, `quick-update`, and `verify-quick-updates` subcommands (not exported) |
| `src/engine/runner.ts` | `runAgentStep()` | Renders prompt and invokes agent for a single step (not exported) |
| `src/engine/runner.ts` | `assertFileExists()` | Checks `expect_file` existence (not exported) |

## Integration Points

- **Depends on**: Agent backend CLIs (`cursor-agent`, `copilot`, `claude`), prompt templates in `prompts/`, flow YAML definitions in `flows/`
- **Used by**: Four CLI subcommands (`init`, `update`, `quick-update`, `verify-quick-updates`) — every subcommand except `install-rules` resolves an agent and executes a flow containing agent steps
- **External systems**: External agent CLI binaries invoked via `execa`

## Extension Guide

- **Add a new backend**: follow the [Adding Agent Backends](../patterns/adding-agent-backends.md) pattern
- **Add a new prompt**: follow the [Creating Prompt Templates](../patterns/creating-prompt-templates.md) pattern
- **Modify model defaults**: edit the `DEFAULT_MODELS` record in `src/cli/backend.ts`
- **Credential handling**: backends handle their own authentication; Saaga does not manage credential env vars
