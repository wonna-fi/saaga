---
title: Agent Interface
type: concept
sources:
  - src/agent/types.ts
  - src/agent/spawn.ts
  - src/agent/stdio.ts
  - src/agent/claude-agent.ts
  - src/agent/copilot-agent.ts
  - src/agent/cursor-agent.ts
  - src/agent/fake-agent.ts
  - src/cli/backend.ts
  - src/doctor/full-probes.ts
terms:
  - AgentRunOpts
  - AgentRunResult
  - fake agent
last_verified: 2026-09-01
---

# Agent Interface

## Business Definition

The boundary between Saaga and the coding agent that does the writing. An **agent** is a
`name` and one method — `run(prompt, opts)` resolving to an exit code — and every
implementation wraps somebody else's CLI. Saaga never speaks to a model API: it spawns a
binary, hands it one prompt, and reads the exit status.

The contract each real backend keeps: the prompt is a command-line argument; the child is
spawned with `execa` under `reject: false`, so a non-zero exit is a return value and a spawn
that throws outright becomes `{ exitCode: 1 }`; `opts.signal` is passed as `cancelSignal`, so
an aborted run kills the child; and stdin is always ignored, because an unattended run must
not block on a prompt. Success is the exit code alone — whether the agent wrote what it was
asked for is judged by [flow execution](../features/flow-execution.md) via `expect_file`.

| Backend | Binary | Prompt | Unrestricted flags | Structured output, under a profile |
|---|---|---|---|---|
| `claude` | `claude` | trailing positional | `--print --dangerously-skip-permissions` | `--verbose --output-format stream-json` |
| `copilot` | `copilot` | `-p <prompt>` | `--allow-all-tools --no-ask-user --no-auto-update` | `--output-format json` (JSONL) |
| `cursor` | `cursor-agent` | trailing positional | `--print --force` | `--output-format stream-json`, else `text` |

Two quirks are load-bearing: `CopilotAgent` renames `<cwd>/.gitignore` to
`.gitignore.<hex>.bak` for the call and restores it in a `finally`, because copilot's glob
indexer honours it and would hide files a documentation run must read; `CursorAgent` under a
profile writes a `cli-config.json` and points `CURSOR_CONFIG_DIR` at it, which is why
`additionalDirs[0]` must be the run directory.

## Configuration

| Source | Precedence | Description |
|--------|------------|-------------|
| `opts.model` on the call | 1 (highest) | The step's `model:`, resolved for this call only |
| The model passed to the constructor | 2 | The run's base model, used when a call names none |

One `Agent` instance therefore serves a whole run whose steps ask for different models; see
[backend resolution](./backend-resolution.md) for where both come from. The `ci` flag the
constructors also take is inert: `ClaudeAgent` and `CursorAgent` store and never read it.

**How to access:**
- `createAgent({ backend, model, ci })` - the concrete agent for a backend
- `agent.run(prompt, opts)` - one agent invocation
- `agent.name` (string) - the backend's name, as printed in the run banner

## Data Storage

| Type | Field/Property | Purpose |
|--------|-------|---------|
| `AgentRunOpts` | `cwd` | Working directory for the child process |
| `AgentRunOpts` | `signal` | Abort signal; execa kills the child when it fires |
| `AgentRunOpts` | `additionalDirs` | Extra directories granted to the CLI; `[0]` is the run directory |
| `AgentRunOpts` | `permissions` | The [profile](./agent-permissions.md); absent means an unrestricted run |
| `AgentRunOpts` | `logFile`, `echo` | Where the child's output is appended, and whether the terminal sees it too |
| `AgentRunOpts` | `onEvent` | Sink for parsed [events](./agent-events.md); the CLI is asked for JSON, so the log holds JSON rather than prose |
| `AgentRunOpts` | `model` | Per-call model override |
| `AgentRunResult` | `exitCode` | 0 for success; anything else fails the step |

## Key Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `agent/types` | `Agent` | The one-method contract every backend implements |
| `agent/types` | `AgentRunOpts`, `AgentRunResult` | Call options and result |
| `agent/claude-agent` | `ClaudeAgent`, `ClaudeAgentOptions` | The `claude` CLI |
| `agent/copilot-agent` | `CopilotAgent`, `CopilotAgentOptions` | The `copilot` CLI |
| `agent/cursor-agent` | `CursorAgent`, `CursorAgentOptions` | The `cursor-agent` CLI |
| `agent/fake-agent` | `FakeAgent`, `FakeScenario`, `FakeAgentCall` | Test double; canned exit codes, no subprocess |
| `agent/spawn` | `awaitProcess()`, `EventConsumer` | Await a child while draining its event stream |
| `agent/stdio` | `buildStdio()`, `buildPipedStdio()` | execa stdio options for the plain and event paths |

`FakeAgent` matches a prompt against substring keys, records every call, runs an optional
`effect` that writes the files a real agent would have, and throws when no scenario matches, so
an unexpected agent call fails a test rather than passing silently. It is how the end-to-end
CLI tests drive whole flows without spending anything.

## Internal Implementation

> - `agent/spawn.awaitProcess()` - drains stdout *concurrently* with awaiting the process: a
>   long transcript fills the pipe buffer and the child blocks on write while the parent waits
>   for an exit that cannot come. A backend that awaits first and reads afterwards deadlocks;
>   `buildPipedStdio()` pipes only stdout for the same reason.

## Reference Implementations

- `src/agent/claude-agent.ts` - the fullest backend: argv, settings JSON, both permission paths
- `src/agent/fake-agent.ts` - the contract with the subprocess removed
- `tests/agent/{claude,copilot,cursor}-agent.test.ts` - argv, stdio and model override

## Related Concepts

- [Backend Resolution](./backend-resolution.md)
- [Agent Permissions](./agent-permissions.md)
- [Agent Events](./agent-events.md)
- [Feature: Flow Execution](../features/flow-execution.md) — the caller on the documented path;
  `saaga doctor --full` (`src/doctor/full-probes.ts`) drives the same interface with a profile
  it builds itself
