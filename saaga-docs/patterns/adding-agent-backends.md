# Adding Agent Backends

## When to Use

Use this pattern when you need to support a new AI coding agent CLI (e.g., a new IDE agent or a custom wrapper) as a Saaga backend. Backends must now handle two execution modes: unrestricted (legacy) and restricted (profile-based), using the shared stdio and spawn helpers.

## Pattern

````typescript
// 1. Create a new file at src/agent/<name>-agent.ts
import { execa, type ResultPromise } from "execa";
import type { AgentEvent, EventParser } from "./events.js";
import { awaitProcess } from "./spawn.js";
import { buildPipedStdio, buildStdio } from "./stdio.js";
import type { Agent, AgentRunOpts, AgentRunResult } from "./types.js";

export interface MyAgentOptions {
  model: string;
  ci?: boolean;
}

export class MyAgent implements Agent {
  readonly name = "my-agent";
  private readonly model: string;

  constructor(opts: MyAgentOptions) {
    this.model = opts.model;
  }

  async run(prompt: string, opts: AgentRunOpts): Promise<AgentRunResult> {
    const args = buildMyAgentArgs(this.model, prompt, opts);

    // Use buildPipedStdio when event parsing is requested, buildStdio otherwise
    const stdio = opts.onEvent ? buildPipedStdio(opts) : buildStdio(opts);

    let proc: ResultPromise;
    try {
      proc = execa("my-agent-cli", args, {
        cwd: opts.cwd,
        reject: false,       // don't throw on non-zero exit
        cancelSignal: opts.signal,
        ...stdio,
      });
    } catch {
      return { exitCode: 1 };
    }

    // awaitProcess drains the event stream concurrently to prevent deadlocks
    const exitCode = await awaitProcess(
      proc,
      opts.onEvent && { parser: createMyAgentEventParser(), sink: opts.onEvent },
    );
    return { exitCode };
  }
}

function buildMyAgentArgs(
  model: string,
  prompt: string,
  opts: AgentRunOpts,
): string[] {
  if (!opts.permissions) {
    // Unrestricted mode: use legacy flags
    return ["--model", model, "--skip-permissions", prompt];
  }

  // Restricted mode: translate the permission profile into native flags
  // Each backend has its own mechanism (deny lists, tool whitelists, settings JSON)
  return [
    "--model", model,
    "--restricted-mode",
    ...(opts.onEvent ? ["--output-format", "json"] : []),
    prompt,
  ];
}

// 2. Create an event parser for the backend's structured output format
export function createMyAgentEventParser(): EventParser {
  return {
    push(line: string): AgentEvent[] {
      // Parse each line of NDJSON output and return normalized AgentEvent objects
      // See createCursorEventParser, createCopilotEventParser, createClaudeEventParser
      // for examples of real parser implementations
      return [];
    },
  };
}

// 3. Register in src/cli/backend.ts — five changes required:
//    a) Add to the Backend type union
//    b) Add default model to DEFAULT_MODELS
//    c) Add default quick model to DEFAULT_QUICK_MODELS
//    d) Add CLI command mapping to BACKEND_CLI_COMMANDS
//    e) Add construction branch in createAgent()
// 4. Add "my-agent" to the ALLOWED_BACKENDS array
````

## Key Points

- Every backend must implement the `Agent` interface from `src/agent/types.ts` — specifically: a `name` string property and an async `run(prompt, opts)` method returning `AgentRunResult`
- **Two execution modes**: backends must check `opts.permissions` — when absent, use legacy unrestricted flags; when present, translate the `AgentPermissions` profile into the backend's native permission mechanism
- **Use shared stdio helpers**: import `buildStdio()` and `buildPipedStdio()` from `src/agent/stdio.ts` instead of creating per-adapter copies. `buildPipedStdio()` pipes stdout through the Node process for event parsing while routing stderr to the log file
- **Use `awaitProcess()`**: import from `src/agent/spawn.ts` to await the process and concurrently drain the event stream. This prevents pipe-buffer deadlocks when the backend writes a long transcript
- **Event parsing**: when `opts.onEvent` is set, the backend should switch to structured JSON output and create an `EventParser` that normalizes the backend-specific format into `AgentEvent` objects (denial events, session events)
- Use `execa` with `reject: false` so the engine receives exit codes instead of exceptions — the runner checks `exitCode` and throws `AgentStepFailedError` on non-zero
- Forward `opts.signal` to enable cancellation support via `AbortSignal`
- Wrap the `execa()` call in try/catch to handle spawn failures (e.g., CLI binary not found) — return `{ exitCode: 1 }` as a fallback
- Register default models in both `DEFAULT_MODELS` (standard subcommands) and `DEFAULT_QUICK_MODELS` (quick-update subcommand)
- Accept a `model` parameter — never hard-code models; the CLI/env resolution chain determines the model

## Reference Implementations

| File | Class/Method | Notes |
|------|-------------|-------|
| `src/agent/cursor-agent.ts` | `CursorAgent` | Restricted mode: writes `cli-config.json` with deny rules, uses `--trust` flag, sets `CURSOR_CONFIG_DIR` env var. Only backend that can honour `read-only-git` shell policy via `allow` entries |
| `src/agent/copilot-agent.ts` | `CopilotAgent` | Restricted mode: uses `--available-tools` whitelist + `--disallow-temp-dir`. Shell is removed entirely (no middle ground). Renames `.gitignore` during invocation |
| `src/agent/claude-agent.ts` | `ClaudeAgent` | Restricted mode: uses `--permission-mode dontAsk` + `--settings` JSON with `allow`/`deny`/`additionalDirectories`. Passes `--strict-mcp-config` to block ambient tool widening |
| `src/agent/fake-agent.ts` | `FakeAgent` | Test double: records `permissions` and `onEvent` in `FakeAgentCall` for assertion |
| `src/agent/stdio.ts` | `buildStdio()`, `buildPipedStdio()` | Shared stdio configuration — all adapters use these instead of per-adapter copies |
| `src/agent/spawn.ts` | `awaitProcess()` | Shared process-await helper with concurrent event stream draining |
| `src/cli/backend.ts` | `createAgent()` | Factory function: branches on `opts.backend` to construct the correct agent class |

## Anti-Patterns

**Do NOT:**

- Throw on non-zero exit codes — the flow runner checks `exitCode` and throws `AgentStepFailedError` itself
- Hard-code models — always accept a `model` parameter from the CLI/env resolution chain
- Bypass the `Agent` interface — all agent invocations go through `Agent.run()` so the engine stays backend-agnostic
- Forget to add to `ALLOWED_BACKENDS` — `resolveBackend()` validates the backend name against this array and rejects unknown values
- Skip `reject: false` in `execa` — without it, non-zero exits become uncaught exceptions instead of structured `AgentRunResult` values
- Implement stdio routing inline — use `buildStdio()` and `buildPipedStdio()` from `src/agent/stdio.ts`
- Await the process without draining stdout — use `awaitProcess()` from `src/agent/spawn.ts` to prevent pipe-buffer deadlocks when event parsing is active
- Ignore `opts.permissions` — backends that only support unrestricted mode will silently bypass the restriction system
