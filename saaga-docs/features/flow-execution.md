---
title: "Feature: Flow Execution"
type: feature
sources:
  - src/engine/runner.ts
  - src/engine/phases.ts
  - src/engine/journal.ts
  - src/engine/prompt-archive.ts
  - src/engine/errors.ts
  - src/engine/primitives/foreach.ts
  - src/engine/primitives/if.ts
  - src/engine/primitives/loop.ts
  - src/engine/primitives/read-file.ts
  - src/engine/primitives/script.ts
terms:
  - runner
  - phase
  - step journal
  - step address
  - prompt archive
last_verified: 2026-09-01
---

# Feature: Flow Execution

## Overview

The runner: given a parsed flow, an initial scope and its dependencies, it walks the steps
in order, drives an agent or a script at each leaf, keeps the terminal informed, and
records enough on disk that an interrupted run resumes where it stopped.

## Key Concepts

Before working with this feature, understand these concepts:
- [Flow Definitions](../concepts/flow-definitions.md)
- [Scope and Expressions](../concepts/scope-and-expressions.md)
- [Prompt Templates](../concepts/prompt-templates.md)
- [Agent Interface](../concepts/agent-interface.md)
- [Script Registry](../concepts/script-registry.md)
- [Run Context](../concepts/run-context.md)

## Functional Specification

### Mechanism

1. `runFlow()` shallow-copies the initial scope, opens a prompt archive on the run
   directory named by `run_dir`, creates a `PhaseTracker`, and logs whether it is starting
   or resuming.
2. Each top-level step is dispatched by `runStep()` under the address `steps[i]`. Before
   anything else, an aborted signal ends the run with `RunAbortedError`, so a Ctrl+C
   between steps never looks like a step failure.
3. **`agent`** resolves its label, claims a phase number, checks the journal, and — if the
   step is genuinely new — renders and runs it:
   1. The model key on the step, or `DEFAULT_MODEL_KEY`, is looked up in `deps.models`;
      anything that is not a non-empty string leaves the model unset and the backend uses
      what it was constructed with.
   2. Each entry of `vars` is interpolated against scope and the
      [template](../concepts/prompt-templates.md) is rendered. On the first agent step a
      *resumed* run actually executes — the one the earlier attempt was interrupted in — a
      note is appended, once, telling the agent partial output may already exist and to
      complete rather than duplicate it. `.saagarules` is appended last, and the exact
      bytes the agent will receive are archived.
   3. Directory preflight: every rendered var value, plus `expect_file`, that is an
      absolute path under the run directory or a granted write root has its parent
      directory created. Values outside those roots are left alone, and relative values are
      skipped entirely — the roots are absolute, and a non-path value must not be resolved
      against the cwd.
   4. `expect_file`'s modification time is captured at nanosecond precision, and the agent
      runs with the working directory, the run directory as an additional allowed
      directory, the [permission profile](../concepts/agent-permissions.md), the run log,
      the verbose flag, the auditor's event callback and the abort signal.
   5. Abort is checked before the exit code: a child that was told to stop is not trusted
      even if it exited cleanly. A non-zero exit is `AgentStepFailedError`, reported with
      the last 20 lines the step wrote to the run log when there is one. `expect_file`,
      when set, must now exist as a file and — if it existed before — must have a different
      modification time.
4. **`script`** does the same, then looks its handler up in the
   [script registry](../concepts/script-registry.md), interpolates every arg against scope,
   and assigns the return value to `set` when the step names one.
5. **`read-file`** interpolates its path, reads the file as UTF-8, optionally trims it, and
   binds it to `set`. It claims no phase number: it is plumbing.
6. **`foreach`** resolves `in` to an array, binds each item to `var` in turn, skips the
   items its `when` predicate rejects, and runs the body. Each surviving item is one phase,
   claimed at its first child.
7. **`loop`** binds `iteration` and `loop_max`, runs the body, and evaluates `until`
   *after* each round, stopping when it holds or when `max` rounds have run. A top-level
   loop is one phase claimed at its first executed step, so a verification round that takes
   a minute is not silent; a nested loop keeps its parent's phase.
8. **`if`** evaluates its condition once. Taken, the body runs in the enclosing context;
   not taken, a top-level `if` claims a phase and prints one `[SKIP]` line carrying
   `skip_label` as the reason.
9. Every completed leaf step is appended to the journal, and its phase line is closed with
   `[DONE]` and a duration. When the last step returns the run logs
   `saaga <flow>: N phases in <duration>`; any error instead closes the phase with
   `[FAIL]`, logs `failed` or `interrupted at phase N/M`, and propagates — the runner never
   swallows a failure or continues past one.

A **phase** is a user-visible unit of work: an agent step, a script step, one surviving
foreach item, a top-level loop, or a skipped `if`. `read-file` counts for nothing. The
total is recomputed from the current scope on every line, because a foreach's item count is
not known until its source array is; until then the counter prints `Phase 3/?`. The label
is the step's interpolated `label`, or the prompt or script name with dashes turned into
spaces, plus `(iteration i/max)` for a step inside a loop.

### Validation Rules

- `foreach.in` must resolve to an array at run time; anything else fails the step.
- `script.name` must be a key of the effective registry; an unknown name fails the step.
- A value assigned through `set` must be JSON-serialisable: the journal replays it.
- An `agent` step with `expect_file` must produce that file during *this* attempt.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Ctrl+C mid-step | The signal is checked before every step and after every agent call; the run ends with `RunAbortedError` naming where it stopped, and the work already journaled is kept |
| Agent exits 0 after being cancelled | Still an interruption: its output is not treated as complete |
| A retry loop re-runs a step whose `expect_file` already exists | Unchanged modification time means the agent wrote nothing, so `ExpectFileUnchangedError` fires rather than the leftover passing as a fresh answer |
| `until` never holds | The loop exits silently at `max`; a flow that must fail in that case follows the loop with a step that enforces the condition |
| The step is already in the journal | It is not re-run: its `set` value is re-applied to scope and the phase line is printed as `[SKIP] … (done in earlier run)` |
| The journal's last line does not parse | Treated as a step that never completed — that is what a kill mid-append leaves; an unparseable line anywhere else is a corrupt journal and an error |
| No run directory in scope | No prompt archive and, as the engine tests use it, no journal; the flow still runs |
| A failure the run's own inputs decide | Thrown as `NonResumableError`, which the [CLI](./cli-entry-point.md) uses to suppress the resume hint |

## Technical Implementation

### Data Model

| Artifact | Key Fields | Purpose |
|--------|------------|---------|
| `<runDir>/steps.jsonl` | `addr`, `type`, `set?`, `value?`, `at` | One JSON object per completed leaf step, appended as it finishes |
| `<runDir>/prompts/NN-<prompt>[-phaseN][-iterN].md` | — | The rendered prompt as the agent received it, `.saagarules` included |

A **step address** locates one execution of one leaf step: `steps[7]@3/do[1]#2/then[0]`,
where `steps[i]`/`do[i]`/`then[i]` are positions in a step list, `@n` is the item index in a
foreach's *unfiltered* source array, and `#n` is the 1-based loop iteration. The same flow
definition run against the same scope produces the same addresses, which is what lets a
resumed run recognise finished work. Flow identity is `flowHash()`, a hash of the *parsed*
definition, so reformatting or a comment edit keeps a run resumable while a structural
change does not; [run context](../concepts/run-context.md) owns how that is checked. The
prompt archive's `NN-` counter continues from the highest prefix already in the directory,
so a resumed run never overwrites the first attempt's prompts.

### Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `engine/runner` | `runFlow()` | Execute a flow against a scope; the engine's entry point |
| `engine/runner` | `RunFlowDeps` | The agent, models, cwd, script registry, logger, log file, permissions, auditor, rules text, prompt archive, journal, abort signal and resume note |
| `engine/runner` | `collectDirsToEnsure()`, `PathModule` | The preflight's path arithmetic, injectable so Windows behaviour is testable from POSIX |
| `engine/runner` | `AgentStepFailedError`, `ExpectFileMissingError`, `ExpectFileUnchangedError`, `RunAbortedError` | The four ways a step ends badly |
| `engine/errors` | `NonResumableError` | Marks a failure resuming cannot clear; its own module so a script need not import the runner |
| `engine/journal` | `createJournal()`, `openJournal()`, `RunJournal`, `StepRecord`, `JOURNAL_FILE` | The step journal and its file |
| `engine/journal` | `flowHash()`, `topLevelAddress()`, `foreachChildAddress()`, `loopChildAddress()`, `ifChildAddress()` | Flow identity for resume, and step-address construction |
| `engine/phases` | `PhaseTracker` | `advance()`, `total()`, `formatCounter()`, `recordIfOutcome()` |
| `engine/prompt-archive` | `createPromptArchive()`, `PromptArchive`, `PromptContext` | Archiving rendered prompts under the run directory |
| `engine/primitives/*` | `runForeachStep()`, `runLoopStep()`, `runIfStep()`, `runReadFileStep()`, `runScriptStep()` | One primitive each; the runner injects itself as the `StepDispatcher` so the primitives never import it back |

## Integration Points

- **Depends on**: the [agent interface](../concepts/agent-interface.md) and its
  [permission profile](../concepts/agent-permissions.md), the
  [script registry](../concepts/script-registry.md),
  [prompt rendering](../concepts/prompt-templates.md),
  [expressions](../concepts/scope-and-expressions.md), the
  [run directory](../concepts/run-context.md).
- **Used by**: the [CLI](./cli-entry-point.md), which is the only caller in the product; it
  assembles `RunFlowDeps`, opens or creates the journal, and maps the errors above to exit
  codes.
- **External systems**: none directly — the backend CLI is reached through the `Agent`.

## Extension Guide

Adding a step primitive is a fixed sequence of edits across the type union, the loader, a
handler module and the runner's dispatch; see
[adding flow primitives](../patterns/adding-flow-primitives.md). Changing what a bundled
flow *does* — its steps, its loop bounds, the prompts it names — is an edit to the flow
YAML and needs no engine change; see
[extending workflows](../patterns/extending-workflows.md). Anything new that assigns to
scope needs a JSON-serialisable value and a journal record under its own address, or a
resumed run will silently redo it.
