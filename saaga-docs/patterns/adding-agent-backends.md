---
title: Adding Agent Backends
type: pattern
sources:
  - src/agent/types.ts
  - src/agent/spawn.ts
  - src/agent/stdio.ts
  - src/agent/events.ts
  - src/agent/claude-agent.ts
  - src/agent/copilot-agent.ts
  - src/agent/cursor-agent.ts
  - src/cli/backend.ts
  - src/cli/config.ts
  - src/doctor/required-flags.ts
  - src/doctor/full-probes.ts
  - src/doctor/probes.ts
  - src/doctor/index.ts
---

# Adding Agent Backends

## When to Use

When another coding-agent CLI should be drivable by `--backend`. The bar: it takes a prompt
non-interactively, exits with a meaningful status, and can be confined to part of the
filesystem — without the last it can only run under `--dangerously-allow-all`. Nothing else
changes; flows, prompts and scripts are backend-neutral by construction.

## Pattern

The files to touch, in this order. The example adds a `gemini` backend.

```typescript
// 1. src/agent/gemini-agent.ts — implement Agent. The constructor takes the run's base
//    model; opts.model overrides it per call.
export class GeminiAgent implements Agent {
  readonly name = "gemini";
  constructor(private readonly opts: GeminiAgentOptions) {}

  async run(prompt: string, opts: AgentRunOpts): Promise<AgentRunResult> {
    const args = buildGeminiArgs(opts.model ?? this.opts.model, prompt, opts);
    const stdio = opts.onEvent ? buildPipedStdio(opts) : buildStdio(opts);
    let proc: ResultPromise;
    try {
      // reject: false — a non-zero exit is a value; cancelSignal — Ctrl+C reaches the child.
      proc = execa("gemini", args, { cwd: opts.cwd, reject: false, cancelSignal: opts.signal, ...stdio });
    } catch {
      return { exitCode: 1 };   // unspawnable, e.g. the binary is missing
    }
    // Never `await proc` first: awaitProcess drains stdout concurrently.
    return { exitCode: await awaitProcess(proc, opts.onEvent && {
      parser: createGeminiEventParser(), sink: opts.onEvent }) };
  }
}

// 2. Translate the profile: no permissions means this CLI's own unrestricted flags, a
//    profile means its native syntax for the same four fields — allow rules where the CLI
//    has them, else deny everything around the roots with enumerateExcludedPaths().
function buildGeminiArgs(model: string, prompt: string, opts: AgentRunOpts): string[] {
  if (!opts.permissions) return ["--yolo", "--model", model, prompt];
  const { readRoots, writeRoots, denyPaths, shell } = opts.permissions;
  return ["--model", model, ...readRoots.map((r) => `--allow-read=${r}`),
    ...writeRoots.map((r) => `--allow-write=${r}`), ...denyPaths.map((p) => `--deny=${p}`),
    shell === "restricted" ? "--allow-shell=readonly" : "--no-shell", prompt];
}

// 3. Parse the event stream: createGeminiEventParser() returns an EventParser whose
//    push(line) yields that line's events — parseJsonLine() to decode, [] for the rest.
//    The kinds it must produce are in ../concepts/agent-events.md.
```

Then `src/cli/backend.ts`: add `"gemini"` to the `Backend` union and to `ALLOWED_BACKENDS`, give
it entries in `DEFAULT_BACKEND_MODELS` and `BACKEND_CLI_COMMANDS`, add its branch to `createAgent()`,
and extend the invalid-backend message — `src/cli/config.ts` holds its own copy of both. Then four
doctor files, each holding literal backend lists that silently pass over a name they omit:
`src/doctor/required-flags.ts`, where `REQUIRED_CLI_FLAGS` gets every flag step 2 can emit;
`src/doctor/full-probes.ts`, where a backend that can scope writes joins `PATH_SCOPING_BACKENDS`
and the three generic restricted-shell probes list their backends; `src/doctor/probes.ts`, whose
`PROBE_CATALOGUE` repeats those arrays for the fast probes; and `src/doctor/index.ts`, where
`runDoctor()` expands `--backend all` from a literal array and `runUnknownModelProbe()` picks argv
from a `===` chain that falls through to claude's flags. Finally `tests/agent/gemini-agent.test.ts`
for the argv under both profiles, plus a captured-output case in `tests/agent/events.test.ts`.

## Key Points

- The compiler catches the `Record<Backend, …>` registrations — `DEFAULT_BACKEND_MODELS`,
  `BACKEND_CLI_COMMANDS`, `REQUIRED_CLI_FLAGS` — and `createAgent()` ends in a `never`
  assignment. It catches none of the plain `Backend[]` arrays or the hand-written backend
  names in error strings — `ALLOWED_BACKENDS` and the probe catalogues' `backends: [...]`
  arrays among them. Grep an existing backend's name and check every hit.
- Pass the prompt as an argument, leave stdin ignored, and treat the exit code as the whole
  result: [agent interface](../concepts/agent-interface.md) has the rest of the contract.
- Translate all four profile fields, or say plainly which one this CLI cannot express — that
  is exactly where the three existing backends differ, and
  [agent permissions](../concepts/agent-permissions.md) records what each manages.
- A parser emits nothing for most lines; unrecognised output is normal, and
  [agent events](../concepts/agent-events.md) covers what has to come out of it. Placement
  and import order follow [file layout](../conventions/file-layout.md) and
  [module imports](../conventions/module-imports.md).

## Reference Implementations

| File | Function/Method | Notes |
| --- | --- | --- |
| `src/agent/claude-agent.ts` | `ClaudeAgent`, `createClaudeEventParser()` | The fullest example: settings JSON, both permission paths, id-correlated denials |
| `src/agent/cursor-agent.ts` | `CursorAgent`, `createCursorEventParser()` | What a deny-only CLI takes: a generated config file and an env override |
| `src/agent/copilot-agent.ts` | `CopilotAgent` | The minimum, plus a pre/post workaround kept in a `finally` |
| `src/agent/fake-agent.ts` | `FakeAgent` | The contract without a subprocess; how the CLI tests drive flows |

## Anti-Patterns

**Do NOT:**

- Await the process and read its output afterwards, or pipe stderr too — both deadlock a run
  as soon as the transcript fills a pipe buffer.
- Throw on a non-zero exit. The exit code is the result; the runner decides what it means.
- Report an unrestricted run as restricted. A backend that cannot enforce the profile should
  express what it can and leave the gap visible for the denial audit to find.
- Teach a flow, prompt or script about the backend: anything backend-specific belongs behind
  `Agent`, which is what makes one corpus reproducible across CLIs.
