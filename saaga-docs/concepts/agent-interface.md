# Agent Interface

## Business Definition

The Agent interface defines how Saaga communicates with external AI coding agents. It abstracts over specific agent backends (Cursor, GitHub Copilot, Claude Code) so the flow engine can invoke any supported agent without knowing the implementation details. Every backend must implement a single `run()` method that accepts a prompt string and returns an exit code.

## Configuration

| Source | Description |
|--------|-------------|
| `--backend` flag / `.saaga/config.yaml` `backend` field | Selects which agent backend to use (`cursor`, `copilot`, or `claude`) |
| `--model` flag / `.saaga/config.yaml` `model` field | Overrides the per-backend default model |
| Backend-specific credentials | Authentication is handled by each backend individually; Saaga does not manage credential env vars |

**How to access:**

- `createAgent(opts)` — constructs a concrete `Agent` for a given backend
- `resolveBackend(input)` — determines which backend to use from flags/config

## Data Storage

| Type | Field/Property | Purpose |
|------|----------------|---------|
| `AgentRunOpts` | `cwd` | Working directory for the agent invocation |
| `AgentRunOpts` | `signal` | Optional `AbortSignal` for cancellation |
| `AgentRunOpts` | `additionalDirs` | Optional `string[]` of extra directories the agent must be able to read/write (e.g. the Saaga run directory, which lives outside the app directory). Backends that sandbox filesystem access should grant access to these paths explicitly |
| `AgentRunOpts` | `logFile` | Optional absolute path to append the agent's stdout/stderr to (for log-file capture) |
| `AgentRunOpts` | `echo` | Optional boolean; when `true`, also mirrors agent output to the terminal (used with `--verbose`) |
| `AgentRunResult` | `exitCode` | Process exit code from the agent CLI |
| `Agent` | `name` | Human-readable backend identifier (e.g. `"cursor"`, `"copilot"`, `"claude"`, `"fake"`) |

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/agent/types.ts` | `Agent` (interface) | Contract: `name` property + `run(prompt, opts)` method |
| `src/agent/types.ts` | `AgentRunOpts` (interface) | Options passed to `Agent.run()`: `cwd`, optional `signal`, `additionalDirs`, `logFile`, `echo` |
| `src/agent/types.ts` | `AgentRunResult` (interface) | Result of `Agent.run()`: contains `exitCode` |
| `src/cli/backend.ts` | `resolveBackend()` | Resolve backend from `--backend` flag → `.saaga/config.yaml` → error |
| `src/cli/backend.ts` | `defaultModelFor()` | Return the default AI model for a given backend |
| `src/cli/backend.ts` | `createAgent()` | Construct a concrete `CursorAgent`, `CopilotAgent`, or `ClaudeAgent` instance |

## Reference Implementations

- `src/agent/cursor-agent.ts` — `CursorAgent` implementation: shells out to `cursor-agent` CLI with `--print --force --model <model> --output-format text` flags. The `--output-format text` flag is always passed (unconditionally, not just in CI mode). Uses `buildStdio(opts)` for output routing: when `logFile` is set, stdout/stderr are appended to the log file; when `echo` is also `true`, output is additionally mirrored to the terminal. Falls back to `stdio: "inherit"` when no `logFile` is configured.
- `src/agent/copilot-agent.ts` — `CopilotAgent` implementation: shells out to `copilot` CLI with `-p <prompt> --allow-all-tools --no-ask-user --model <model> --no-auto-update`. Passes `--add-dir` flags for each path in `opts.additionalDirs` (e.g. the Saaga run directory), granting Copilot access to directories outside `cwd`. Temporarily renames `.gitignore` to `.gitignore.<random-hex>.bak` (using a random suffix to prevent collisions) before invocation so Copilot's glob indexer can see all files. Uses `buildStdio(opts)` for log-file capture and optional terminal echo, same as `CursorAgent`.
- `src/agent/claude-agent.ts` — `ClaudeAgent` implementation: shells out to `claude` CLI with `--print --dangerously-skip-permissions --model <model>` flags. Uses `buildStdio(opts)` for log-file capture and optional terminal echo, same as `CursorAgent`.
- `src/agent/fake-agent.ts` — `FakeAgent` test double: returns canned results by substring-matching against the prompt. Records every call in a `calls` array (including `additionalDirs`) for test assertions. Supports optional `effect` callbacks to simulate the agent writing files.

## Internal Implementation

- `buildStdio()` in `src/agent/cursor-agent.ts`, `src/agent/copilot-agent.ts`, `src/agent/claude-agent.ts` — internal helper that configures stdio routing based on `logFile` and `echo` options (not exported; each adapter has its own copy)
- `tryRename()` and `pathExists()` in `src/agent/copilot-agent.ts` — internal helpers for the `.gitignore` rename dance (not exported)

## Related Concepts

- [Templates and Prompt Rendering](./templates-and-prompt-rendering.md)
- [Package Paths](./package-paths.md)
- [Output and Progress Display](./output-and-progress.md)
