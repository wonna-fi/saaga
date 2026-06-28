# Adding Agent Backends

## When to Use

Use this pattern when you need to support a new AI coding agent CLI (e.g., a new IDE agent or a custom wrapper) as a Saaga backend.

## Pattern

```typescript
// 1. Create a new file at src/agent/<name>-agent.ts
import { execa, type ResultPromise } from "execa";
import type { Agent, AgentRunOpts, AgentRunResult } from "./types.js";

export interface MyAgentOptions {
  model: string;
  ci?: boolean;
}

export class MyAgent implements Agent {
  readonly name = "my-agent";
  private readonly model: string;
  private readonly ci: boolean;

  constructor(opts: MyAgentOptions) {
    this.model = opts.model;
    this.ci = opts.ci ?? false;
  }

  async run(prompt: string, opts: AgentRunOpts): Promise<AgentRunResult> {
    const args = ["--model", this.model];
    if (this.ci) {
      args.push("--non-interactive");
    }
    args.push(prompt);

    let proc: ResultPromise;
    try {
      proc = execa("my-agent-cli", args, {
        cwd: opts.cwd,
        reject: false,       // don't throw on non-zero exit
        signal: opts.signal,  // forward cancellation
        stdio: "inherit",    // stream agent output to terminal
      });
    } catch {
      return { exitCode: 1 };
    }

    const result = await proc;
    return { exitCode: result.exitCode ?? 1 };
  }
}

// 2. Register in src/cli/backend.ts — four changes required:

// a) Add to the Backend type union:
//    export type Backend = "cursor" | "copilot" | "claude" | "my-agent";

// b) Add default model to DEFAULT_MODELS:
//    const DEFAULT_MODELS: Record<Backend, string> = {
//      cursor: "claude-4.6-opus-high-thinking",
//      copilot: "claude-sonnet-4.5",
//      claude: "opus",
//      "my-agent": "gpt-4o",
//    };

// c) Add default quick model to DEFAULT_QUICK_MODELS:
//    const DEFAULT_QUICK_MODELS: Record<Backend, string> = {
//      cursor: "claude-4.6-sonnet-medium-thinking",
//      copilot: "claude-sonnet-4.5",
//      claude: "sonnet",
//      "my-agent": "gpt-4o-mini",
//    };

// d) Add construction branch in createAgent():
//    if (opts.backend === "my-agent") {
//      return new MyAgent({ model: opts.model, ci: opts.ci });
//    }

// 3. Add "my-agent" to the ALLOWED_BACKENDS array:
//    const ALLOWED_BACKENDS: readonly Backend[] = ["cursor", "copilot", "claude", "my-agent"];
```

## Key Points

- Every backend must implement the `Agent` interface from `src/agent/types.ts` — specifically: a `name` string property and an async `run(prompt, opts)` method returning `AgentRunResult`
- Use `execa` with `reject: false` so the engine receives exit codes instead of exceptions — the runner checks `exitCode` and throws `AgentStepFailedError` on non-zero
- Forward `opts.signal` to enable cancellation support via `AbortSignal`
- Wrap the `execa()` call in try/catch to handle spawn failures (e.g., CLI binary not found) — return `{ exitCode: 1 }` as a fallback
- Pass `stdio: "inherit"` to `execa` so the agent's stdout/stderr streams to the terminal — all three existing backends use this convention
- Register default models in both `DEFAULT_MODELS` (standard subcommands) and `DEFAULT_QUICK_MODELS` (quick-update subcommand) — the `quick-update` subcommand uses a cheaper/faster model by default
- Accept a `model` parameter — never hard-code models; the CLI/env resolution chain determines the model

## Reference Implementations

| File | Class/Method | Notes |
|------|-------------|-------|
| `src/agent/cursor-agent.ts` | `CursorAgent` | Simple backend: passes prompt as a positional arg to `cursor-agent` CLI with `--print --force` flags |
| `src/agent/copilot-agent.ts` | `CopilotAgent` | Complex backend: renames `.gitignore` → `.gitignore.<random-hex>.bak` before invocation so Copilot's indexer sees all files, restores it in a `finally` block |
| `src/agent/claude-agent.ts` | `ClaudeAgent` | Claude Code backend: passes prompt as a positional arg to `claude` CLI with `--print --dangerously-skip-permissions` flags |
| `src/agent/fake-agent.ts` | `FakeAgent` | Test double: returns canned results by substring-matching against the prompt, supports `effect` callbacks for simulating file writes |
| `src/cli/backend.ts` | `createAgent()` | Factory function: branches on `opts.backend` to construct the correct agent class |

## Anti-Patterns

**Do NOT:**

- Throw on non-zero exit codes — the flow runner checks `exitCode` and throws `AgentStepFailedError` itself
- Hard-code models — always accept a `model` parameter from the CLI/env resolution chain
- Bypass the `Agent` interface — all agent invocations go through `Agent.run()` so the engine stays backend-agnostic
- Forget to add to `ALLOWED_BACKENDS` — `resolveBackend()` validates the backend name against this array and rejects unknown values
- Skip `reject: false` in `execa` — without it, non-zero exits become uncaught exceptions instead of structured `AgentRunResult` values
