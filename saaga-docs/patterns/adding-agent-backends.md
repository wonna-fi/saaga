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
  - src/agent/kiro-agent.ts
  - src/agent/codex-agent.ts
  - src/agent/fake-agent.ts
  - src/cli/backend.ts
  - src/cli/config.ts
  - src/doctor/required-flags.ts
  - src/doctor/full-probes.ts
  - src/doctor/probes.ts
  - src/doctor/index.ts
  - src/doctor/kiro-probes.ts
last_verified: 2026-10-05
---

# Adding Agent Backends

## When to Use

When another coding-agent CLI should be drivable by `--backend`. The bar: it takes a prompt
non-interactively, exits with a meaningful status, and can be confined to part of the filesystem
— without the last it can only run under `--dangerously-allow-all`.

## Pattern

The files to touch, in this order. The example adds a `gemini` backend.

```typescript
// 1. src/agent/gemini-agent.ts — implement Agent; opts.model overrides the base model per call.
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
    return { exitCode: await awaitProcess(proc, opts.onEvent && {
      parser: createGeminiEventParser(), sink: opts.onEvent }) };
  }
}

// 2. No profile: the CLI's own unrestricted flags. A profile: its native syntax for the four
//    fields — allow rules if it has them, else deny around the roots (enumerateExcludedPaths()).
function buildGeminiArgs(model: string, prompt: string, opts: AgentRunOpts): string[] {
  if (!opts.permissions) return ["--yolo", "--model", model, prompt];
  const { readRoots, writeRoots, denyPaths, shell } = opts.permissions;
  return ["--model", model, ...readRoots.map((r) => `--allow-read=${r}`),
    ...writeRoots.map((r) => `--allow-write=${r}`), ...denyPaths.map((p) => `--deny=${p}`),
    shell === "restricted" ? "--allow-shell=readonly" : "--no-shell", prompt];
}

// 3. createGeminiEventParser() returns an EventParser whose push(line) yields that line's
//    events — parseJsonLine() to decode, [] for the rest.
```

Then `src/cli/backend.ts`: add `"gemini"` to the `Backend` union and `ALLOWED_BACKENDS`, give it
entries in `DEFAULT_BACKEND_MODELS` and `BACKEND_CLI_COMMANDS`, add its `createAgent()` branch, and
extend the invalid-backend message — `src/cli/config.ts` holds its own copy of both, and its
`parseBackendConfig()` is where a backend-only key goes (as codex's `fast`). Then the
`src/doctor/` files, whose literal backend lists silently pass over a name they omit: `required-flags.ts`
(`REQUIRED_CLI_FLAGS` gets every flag step 2 can emit; `BACKEND_HELP_ARGS` names the subcommand
if they live under one), `full-probes.ts` (`PATH_SCOPING_BACKENDS` if it can scope writes, and
the three restricted-shell probes), `probes.ts` (`PROBE_CATALOGUE` repeats those arrays), and
`index.ts` (`runDoctor()` expands `--backend all` from a literal array; `runUnknownModelProbe()`
picks argv from a `===` chain that falls through to claude's flags, and `unknownModelOutcome()`
needs its own branch if the CLI echoes the requested model, as codex does). A CLI with account state a
run could trip over gets its own fast-probe module under `<backend>/` ids, as
`src/doctor/kiro-probes.ts` does, called from the fast-tier dispatch in `index.ts`. Finally
`tests/agent/gemini-agent.test.ts` for the argv under both profiles, and a captured-output case
in `tests/agent/events.test.ts`.

## Key Points

- The compiler catches the `Record<Backend, …>` registrations — `DEFAULT_BACKEND_MODELS`,
  `BACKEND_CLI_COMMANDS`, `REQUIRED_CLI_FLAGS` — and `createAgent()` ends in a `never`
  assignment. It catches none of the plain `Backend[]` arrays, the `Partial` `BACKEND_HELP_ARGS`,
  or the hand-written names in error strings. Grep an existing backend's name and check every hit.
- Pass the prompt as an argument, leave stdin ignored, and treat the exit code as the whole
  result: [agent interface](../concepts/agent-interface.md) has the rest of the contract.
- Translate all four profile fields, or say plainly which one this CLI cannot express; see
  [agent permissions](../concepts/agent-permissions.md) for what each backend manages.
- A parser emits nothing for most lines; [agent events](../concepts/agent-events.md) has the
  kinds it must produce, [doctor](../features/doctor.md) the probe dispatch, and
  [file layout](../conventions/file-layout.md) and [module imports](../conventions/module-imports.md) the placement.

## Reference Implementations

| File | Function/Method | Notes |
| --- | --- | --- |
| `src/agent/claude-agent.ts` | `ClaudeAgent`, `createClaudeEventParser()` | The fullest example: settings JSON, both permission paths, id-correlated denials |
| `src/agent/cursor-agent.ts` | `CursorAgent`, `createCursorEventParser()` | What a deny-only CLI takes: a generated config file and an env override |
| `src/agent/copilot-agent.ts` | `CopilotAgent` | The minimum, plus a pre/post workaround kept in a `finally` |
| `src/agent/kiro-agent.ts` | `KiroAgent`, `buildKiroArgs()`, `buildKiroPermissionRules()` | A subcommand CLI (`chat`), process-group signalling, a login-hang guard, a profile outside the run directory |
| `src/agent/codex-agent.ts` | `CodexAgent`, `buildCodexArgs()`, `probeCodexExecutable()` | A profile passed as `--config` TOML, a shell gated by a hook whose policy rides in argv, a pre-run probe feeding the sandbox, stderr parsed through a transform, and a backend-only option (`fast`) |
| `src/doctor/kiro-probes.ts` | `runKiroAccountProbes()` | A backend-specific fast-probe module, testable through an injected command runner |
| `src/agent/fake-agent.ts` | `FakeAgent` | The contract without a subprocess; how the CLI tests drive flows |

## Anti-Patterns

**Do NOT:**

- Await the process and read its output afterwards, or pipe stderr too — both deadlock a run
  as soon as the transcript fills a pipe buffer. Stderr worth parsing goes through an execa
  transform, as in `CodexAgent`.
- Throw on a non-zero exit. The exit code is the result; the runner decides what it means.
- Rely on `cancelSignal` when the binary is a launcher whose child ignores signals sent to it
  alone: spawn it detached and signal the process group, as `KiroAgent` does.
- Report an unrestricted run as restricted: enforce what the CLI can and leave the gap for the denial audit.
- Teach a flow, prompt or script about the backend: flows, prompts and scripts are
  backend-neutral by construction, which is what makes one corpus reproducible across CLIs.
