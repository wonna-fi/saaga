# Agent Interface

## Business Definition

The Agent interface defines how Saaga communicates with external AI coding agents. It abstracts over specific agent backends (Cursor, GitHub Copilot, Claude Code) so the flow engine can invoke any supported agent without knowing the implementation details. Every backend must implement a single `run()` method that accepts a prompt string and returns an exit code.

## Configuration

| Source | Description |
|--------|-------------|
| `--backend` flag / `SAAGA_BACKEND` env var | Selects which agent backend to use (`cursor`, `copilot`, or `claude`) |
| `--model` flag / `AGENT_MODEL` env var | Overrides the per-backend default model |
| Backend-specific credentials | Authentication is handled by each backend individually; Saaga does not manage credential env vars |

**How to access:**

- `createAgent(opts)` — constructs a concrete `Agent` for a given backend
- `resolveBackend(input)` — determines which backend to use from flags/env

## Data Storage

| Type | Field/Property | Purpose |
|------|----------------|---------|
| `AgentRunOpts` | `cwd` | Working directory for the agent invocation |
| `AgentRunOpts` | `signal` | Optional `AbortSignal` for cancellation |
| `AgentRunResult` | `exitCode` | Process exit code from the agent CLI |
| `Agent` | `name` | Human-readable backend identifier (e.g. `"cursor"`, `"copilot"`, `"claude"`, `"fake"`) |

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/agent/types.ts` | `Agent` (interface) | Contract: `name` property + `run(prompt, opts)` method |
| `src/agent/types.ts` | `AgentRunOpts` (interface) | Options passed to `Agent.run()`: `cwd` and optional `signal` |
| `src/agent/types.ts` | `AgentRunResult` (interface) | Result of `Agent.run()`: contains `exitCode` |
| `src/cli/backend.ts` | `resolveBackend()` | Resolve backend from `--backend` flag → `SAAGA_BACKEND` env var → error |
| `src/cli/backend.ts` | `defaultModelFor()` | Return the default AI model for a given backend |
| `src/cli/backend.ts` | `createAgent()` | Construct a concrete `CursorAgent`, `CopilotAgent`, or `ClaudeAgent` instance |

## Reference Implementations

- `src/agent/cursor-agent.ts` — `CursorAgent` implementation: shells out to `cursor-agent` CLI with `--print --force --model <model>` flags. In CI mode, adds `--output-format text`. Passes `stdio: "inherit"` to `execa`, so the agent child-process stdout/stderr is inherited by the parent process and visible in the terminal.
- `src/agent/copilot-agent.ts` — `CopilotAgent` implementation: shells out to `copilot` CLI with `-p <prompt> --allow-all-tools --no-ask-user --model <model> --no-auto-update`. Temporarily renames `.gitignore` to `.gitignore.<random-hex>.bak` (using a random suffix to prevent collisions) before invocation so Copilot's glob indexer can see all files. Passes `stdio: "inherit"` to `execa`, so the agent child-process stdout/stderr is inherited by the parent process and visible in the terminal.
- `src/agent/claude-agent.ts` — `ClaudeAgent` implementation: shells out to `claude` CLI with `--print --dangerously-skip-permissions --model <model>` flags. The `ci` option is stored but does not modify CLI arguments (unlike `CursorAgent`, which adds `--output-format text` in CI mode). Passes `stdio: "inherit"` to `execa`, so the agent child-process stdout/stderr is inherited by the parent process and visible in the terminal.
- `src/agent/fake-agent.ts` — `FakeAgent` test double: returns canned results by substring-matching against the prompt. Records every call in a `calls` array for test assertions. Supports optional `effect` callbacks to simulate the agent writing files.

## Internal Implementation

- `tryRename()` and `pathExists()` in `src/agent/copilot-agent.ts` — internal helpers for the `.gitignore` rename dance (not exported)

## Related Concepts

- [Templates and Prompt Rendering](./templates-and-prompt-rendering.md)
- [Package Paths](./package-paths.md)
