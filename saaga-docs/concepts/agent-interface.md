# Agent Interface

## Business Definition

The Agent interface defines how Saaga communicates with external AI coding agents. It abstracts over specific agent backends (Cursor, GitHub Copilot, Claude Code) so the flow engine can invoke any supported agent without knowing the implementation details. Every backend must implement a single `run()` method that accepts a prompt string and returns an exit code. Backends operate in two modes: unrestricted (legacy) and restricted (profile-based), where the permission profile constrains filesystem and shell access.

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
| `AgentRunOpts` | `additionalDirs` | Optional `string[]`; now used to pass the run directory path for backends that need it (e.g. Cursor places `cli-config.json` under `<additionalDirs[0]>/.cursor-cli/`). Since the run directory is now under `<cwd>/.saaga-runs/`, it is always inside `cwd` and backends no longer need to grant separate filesystem access for it |
| `AgentRunOpts` | `permissions` | Optional `AgentPermissions` profile. When absent, the backend uses its legacy unrestricted flags. When present, the backend translates the profile into its native permission mechanism |
| `AgentRunOpts` | `logFile` | Optional absolute path to append the agent's stdout/stderr to (for log-file capture) |
| `AgentRunOpts` | `echo` | Optional boolean; when `true`, also mirrors agent output to the terminal (used with `--verbose`) |
| `AgentRunOpts` | `onEvent` | Optional `AgentEventSink` callback. When set, the backend switches to structured JSON output and forwards parsed events (denials, session info) through this callback. The log file receives JSON rather than prose |
| `AgentRunResult` | `exitCode` | Process exit code from the agent CLI |
| `Agent` | `name` | Human-readable backend identifier (e.g. `"cursor"`, `"copilot"`, `"claude"`, `"fake"`) |

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/agent/types.ts` | `Agent` (interface) | Contract: `name` property + `run(prompt, opts)` method |
| `src/agent/types.ts` | `AgentRunOpts` (interface) | Options passed to `Agent.run()`: `cwd`, optional `signal`, `additionalDirs`, `permissions`, `logFile`, `echo`, `onEvent` |
| `src/agent/types.ts` | `AgentRunResult` (interface) | Result of `Agent.run()`: contains `exitCode` |
| `src/cli/backend.ts` | `resolveBackend()` | Resolve backend from `--backend` flag → `.saaga/config.yaml` → error |
| `src/cli/backend.ts` | `defaultModelFor()` | Return the default AI model for a given backend |
| `src/cli/backend.ts` | `createAgent()` | Construct a concrete `CursorAgent`, `CopilotAgent`, or `ClaudeAgent` instance |
| `src/agent/stdio.ts` | `buildStdio()` | Build execa stdio options for standard agent output routing (inherit, log file, or tee) |
| `src/agent/stdio.ts` | `buildPipedStdio()` | Build execa stdio options that pipe stdout for event stream parsing while routing stderr to log file |
| `src/agent/spawn.ts` | `awaitProcess()` | Await a spawned agent process, concurrently draining its stdout for event parsing when requested |
| `src/agent/cursor-agent.ts` | `CursorAgent` (class) | Cursor backend adapter |
| `src/agent/cursor-agent.ts` | `createCursorEventParser()` | Create an `EventParser` for Cursor's `stream-json` output format |
| `src/agent/copilot-agent.ts` | `CopilotAgent` (class) | GitHub Copilot backend adapter |
| `src/agent/copilot-agent.ts` | `createCopilotEventParser()` | Create an `EventParser` for Copilot's JSONL output format |
| `src/agent/claude-agent.ts` | `ClaudeAgent` (class) | Claude Code backend adapter |
| `src/agent/claude-agent.ts` | `createClaudeEventParser()` | Create an `EventParser` for Claude's `stream-json` output format |
| `src/agent/claude-agent.ts` | `CLAUDE_RESTRICTED_TOOLS` (constant) | The expected tool surface for a restricted Claude run: `Edit`, `Glob`, `Grep`, `Read`, `Write` |

## Reference Implementations

- `src/agent/cursor-agent.ts` — `CursorAgent` implementation: in unrestricted mode, shells out to `cursor-agent` CLI with `--print --force --model <model> --output-format text`. In restricted mode, uses `--trust` instead of `--force`, writes a `cli-config.json` with deny rules under `<runDir>/.cursor-cli/`, and sets `CURSOR_CONFIG_DIR` to point there. The deny rules enumerate everything outside the permitted read/write roots. Shell access is expressed via `allow` entries for read-only git subcommands. When `onEvent` is set, uses `--output-format stream-json` and pipes stdout through `createCursorEventParser()`.
- `src/agent/copilot-agent.ts` — `CopilotAgent` implementation: in unrestricted mode, shells out to `copilot` CLI with `-p <prompt> --allow-all-tools --no-ask-user --model <model> --no-auto-update` and passes `--add-dir` for each `additionalDirs` entry. In restricted mode, uses `--available-tools` to whitelist only `view`, `create`, `edit`, `glob`, `grep` (no shell), passes `--allow-all-tools` (required for non-interactive runs) and `--disallow-temp-dir` to prevent temp directory access, and grants `--add-dir` for roots outside `cwd`. Temporarily renames `.gitignore` to `.gitignore.<random-hex>.bak` before invocation so Copilot's glob indexer can see all files. When `onEvent` is set, adds `--output-format json` and pipes stdout through `createCopilotEventParser()`.
- `src/agent/claude-agent.ts` — `ClaudeAgent` implementation: in unrestricted mode, shells out to `claude` CLI with `--print --dangerously-skip-permissions --model <model>`. In restricted mode, uses `--permission-mode dontAsk` with `--settings` JSON that specifies `allow` rules for edit roots, `deny` rules for withheld tools and paths, and `additionalDirectories` for read reach beyond `cwd`. Passes `--strict-mcp-config` (with no `--mcp-config`) to prevent ambient configs from widening the tool surface. When `onEvent` is set, adds `--verbose --output-format stream-json` and pipes stdout through `createClaudeEventParser()`.
- `src/agent/fake-agent.ts` — `FakeAgent` test double: returns canned results by substring-matching against the prompt. Records every call in a `calls` array (including `additionalDirs`, `permissions`, and `onEvent`) for test assertions. Supports optional `effect` callbacks to simulate the agent writing files.

## Internal Implementation

> Functions below are internal and should not be called directly. They are documented for understanding the internal logic.

- `writeCursorConfig()` in `src/agent/cursor-agent.ts` — generates `cli-config.json` with deny rules under the run directory (not exported)
- `buildRestrictedCopilotArgs()` in `src/agent/copilot-agent.ts` — constructs restricted-mode CLI arguments for Copilot (not exported)
- `buildClaudeSettings()` in `src/agent/claude-agent.ts` — builds the settings JSON that expresses the permission profile for Claude (not exported)
- `tryRename()` and `pathExists()` in `src/agent/copilot-agent.ts` — internal helpers for the `.gitignore` rename dance (not exported)

## Related Concepts

- [Agent Permissions and Restriction](./agent-permissions.md)
- [Agent Events and Denial Parsing](./agent-events.md)
- [Templates and Prompt Rendering](./templates-and-prompt-rendering.md)
- [Package Paths](./package-paths.md)
- [Output and Progress Display](./output-and-progress.md)
