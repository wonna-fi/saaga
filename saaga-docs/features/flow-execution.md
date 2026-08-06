# Feature: Flow Execution

## Overview

Flow execution is the core runtime process that takes a loaded `FlowDefinition` and runs each step sequentially. The runner dispatches steps by type, renders agent prompts, invokes scripts, evaluates predicates for control flow, and asserts expected file outputs.

## Key Concepts

Before working with this feature, understand these concepts:

- [Flow DSL](../concepts/flow-dsl.md)
- [Scope and Expressions](../concepts/scope-and-expressions.md)
- [Agent Interface](../concepts/agent-interface.md)
- [Templates and Prompt Rendering](../concepts/templates-and-prompt-rendering.md)
- [Output and Progress Display](../concepts/output-and-progress.md)

## Functional Specification

### Execution Flow

1. `runFlow()` receives a `FlowDefinition`, initial scope, and dependencies (`RunFlowDeps`)
2. Resolves a logger from `deps.logger` (falls back to a silent logger that writes to a no-op stream)
3. Creates a `PhaseTracker` for the flow to track progress as `Phase N/M`
4. Logs flow start as a detail line: `flow <name>: starting (<N> steps)`
5. Creates a shallow copy of the initial scope
6. Iterates through `flow.steps` sequentially
7. For each step, dispatches to the appropriate handler based on `step.type`; top-level agent and script steps emit phase-progress lines (`Phase N/M: label [DONE] duration`) instead of verbose `[INFO]` banners
8. On successful completion, emits a final summary phase line: `saaga <name>: <total> phases in <duration> [DONE]`. On failure, emits `saaga <name>: failed at phase Phase N/M after <duration> [FAIL]` before re-throwing

### Step Dispatch Table

| Step Type | Handler | Behavior |
|-----------|---------|----------|
| `agent` | `runAgentStep()` (internal) | Resolves label via `resolveLabel()`, advances the phase tracker (if top-level or first in foreach), emits `phaseBegin()` with `Phase N/M: label`, renders prompt, calls `Agent.run()` with `additionalDirs` (from `scope.run_dir`), `permissions`, `logFile`, `echo`, and `onEvent` (from auditor). Emits `phaseEnd("DONE")` on success or `phaseEnd("FAIL")` on failure (with log tail). Asserts `expect_file`. |
| `script` | `runScriptStep()` | Resolves label, advances phase tracker, emits `phaseBegin()` / `phaseEnd()`. Looks up script in registry, interpolates args, executes handler, optionally stores result in scope. |
| `foreach` | `runForeachStep()` via `runForeachWithPhases()` | Resolves array from scope, logs item count as a detail line. Advances the phase tracker once per iteration (on the first child step). Child steps run with `insideForeach: true` context. |
| `loop` | `runLoopStep()` via `runLoopWithPhases()` | Repeats body up to `max` times, sets `${iteration}`, exits early when `until:` is true. Child steps inherit the parent's foreach context and include iteration suffixes (e.g. `(iteration 2/3)`) in phase lines. |
| `if` | `runIfStep()` | Evaluates condition predicate, records the outcome in `PhaseTracker`. If taken, executes `then:` body. If skipped at top level, advances the phase tracker and emits `phaseImmediate()` with `[SKIP]` marker, using the step's `label` and `skip_label` for the display text. |
| `read-file` | `runReadFileStep()` | Reads file at interpolated path, stores contents in scope variable. Logs detail lines only (no phase line — read-file is plumbing). |

### Agent Step Execution Detail

1. Resolves prompt file path: `<PROMPTS_DIR>/<step.prompt>.md`
2. Interpolates each `vars` value using `interpolate(raw, scope)` — resolves `${expr}` references
3. Renders the prompt template file: `renderPromptFile(path, renderedVars)` — substitutes `{key}` placeholders
4. Constructs `additionalDirs` from `scope.run_dir` (if it is a string); constructs `onEvent` callback from `deps.auditor` (if present — calls `auditor.record(event)` for each event); calls `deps.agent.run(prompt, { cwd: deps.cwd, additionalDirs, permissions: deps.permissions, logFile: deps.logFile, echo: deps.verbose, onEvent })`
5. If exit code is non-zero, throws `AgentStepFailedError`; before re-throwing, calls `printFailureTail()` to show the last lines from the log file
6. If `expect_file` is defined, interpolates the path and asserts the file exists — throws `ExpectFileMissingError` if missing

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Agent exits with non-zero code | Throws `AgentStepFailedError` with `promptName` and `exitCode` |
| `expect_file` path does not exist after agent | Throws `ExpectFileMissingError` with `path` and `promptName` |
| `expect_file` path exists but is not a file | Throws `ExpectFileMissingError` |
| Unknown script name | Throws `Error: Unknown script: <name>` |
| `foreach.in` resolves to non-array | Throws `Error: 'foreach.in' must resolve to an array` |
| Undefined variable in `${expr}` | Throws `ExpressionError: Undefined variable: <path>` |
| Property access on null/undefined | Throws `ExpressionError: Cannot read property '<field>'...` |
| Unknown step type | Throws `Error: Unsupported step type: '<type>'` |
| `loop` reaches `max` without `until:` becoming true | Loop simply ends (no error) |
| No `logger` provided in `RunFlowDeps` | A silent logger (writes to a no-op `Writable` stream) is used as default — no output produced |

## Technical Implementation

### Dependencies Interface

```typescript
import type { PermissionAuditor } from "../agent/audit.js";
import type { AgentPermissions } from "../agent/permissions.js";
import { Logger } from "../logger.js";

interface RunFlowDeps {
  agent: Agent;                       // Backend for agent steps
  cwd: string;                        // Working directory for agent invocations
  scripts?: ScriptRegistry;           // Override script registry (for tests)
  logger?: Logger;                    // Structured logger for flow progress output (defaults to silent)
  logFile?: string;                   // Absolute path to the run log file for agent output capture
  verbose?: boolean;                  // Mirror agent output to terminal (--verbose)
  permissions?: AgentPermissions;     // Permission profile for agent steps; absent means unrestricted
  auditor?: PermissionAuditor;        // Collects/classifies denial events; switches agent to structured output
}
```

### Services/Functions

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/engine/runner.ts` | `runFlow()` | Main entry point: executes a flow definition with given scope and dependencies |
| `src/engine/runner.ts` | `RunFlowDeps` (interface) | Configuration for the execution environment: `agent`, `cwd`, optional `scripts`, `logger`, `logFile`, `verbose`, `permissions`, `auditor` |
| `src/engine/runner.ts` | `ExpectFileMissingError` (class) | Thrown when `expect_file` assertion fails |
| `src/engine/runner.ts` | `AgentStepFailedError` (class) | Thrown when an agent step exits with non-zero code |
| `src/engine/phases.ts` | `PhaseTracker` (class) | Tracks the flat phase index and dynamically computes the total for `Phase N/M` progress display |
| `src/output.ts` | `OutputSink` (class) | Core output backend: pending-line state, TTY spinner, column-aligned markers, log-file append |
| `src/output.ts` | `formatDuration()` | Formats elapsed milliseconds as `Nms`, `N.Ns`, or `NmSSs` |
| `src/engine/expression.ts` | `interpolate()` | Resolves `${var}` expressions in step vars, paths, and args |
| `src/engine/expression.ts` | `resolveValue()` | Resolves values preserving type (used by foreach for arrays) |
| `src/engine/expression.ts` | `evaluatePredicate()` | Evaluates conditions for loop/foreach/if |
| `src/engine/primitives/foreach.ts` | `runForeachStep()` | Handles foreach iteration with filtering and child dispatch |
| `src/engine/primitives/loop.ts` | `runLoopStep()` | Handles loop with max cap and until predicate |
| `src/engine/primitives/if.ts` | `runIfStep()` | Handles conditional execution |
| `src/engine/primitives/read-file.ts` | `runReadFileStep()` | Handles file reading into scope |
| `src/engine/primitives/script.ts` | `runScriptStep()` | Handles script lookup, arg interpolation, and result storage |
| `src/logger.ts` | `Logger` (class) | Facade over `OutputSink` with `info()`, `warn()`, `error()`, `phaseBegin()`, `phaseEnd()`, `phaseImmediate()`, `detail()`, `logFileSize()`, `tailLog()`, `child()`, `getSink()`, `dispose()` |
| `src/logger.ts` | `LoggerOptions` (interface) | Configuration: `ci?`, `stream?`, `indent?`, `logFile?`, `verbose?` |
| `src/logger.ts` | `silentLogger()` | Returns a singleton `Logger` writing to a no-op stream (default when no logger provided) |

### Internal Implementation

> Functions below are internal to `src/engine/runner.ts` and should not be called directly. They are documented for understanding the phase-tracking and control-flow delegation logic.
>
> - `runStep()` — dispatches a single step by type, manages phase tracking and phase-line emission based on `StepContext`
> - `runForeachWithPhases()` — wraps `runForeachStep()` with phase-tracker advancement (once per iteration, on the first child step)
> - `runLoopWithPhases()` — wraps `runLoopStep()` with loop iteration context (iteration number and max) for phase-line suffixes
> - `runAgentStep()` — resolves the prompt template, renders it, constructs `additionalDirs` from `scope.run_dir`, passes `permissions` and `onEvent` (from auditor) to the agent, invokes with `logFile`/`echo`, and asserts `expect_file`
> - `resolveLabel()` — resolves the step's `label` field via interpolation, falling back to the step name with hyphens replaced by spaces
> - `buildPhaseLine()` — constructs the phase line string from counter, label, and iteration suffix
> - `formatIterSuffix()` — produces the `(iteration N/M)` suffix for steps inside a loop, or empty string otherwise
> - `describeAgentContext()` — extracts interesting vars (`phase_number`, `iteration`) for detail log lines
> - `printFailureTail()` — reads the last 20 lines from the log file (from a byte offset) and emits them as error lines after an agent step failure
> - `assertFileExists()` — asserts a path exists and is a file

## Integration Points

- **Depends on**: Agent backend (via `RunFlowDeps.agent`), template rendering (`renderPromptFile`), script registry (`defaultScriptRegistry`), expression engine (`interpolate`, `resolveValue`, `evaluatePredicate`), `Logger` (via `RunFlowDeps.logger`, optional), `PhaseTracker` (`src/engine/phases.ts`), `OutputSink` (`src/output.ts`), `formatDuration()` (`src/output.ts`)
- **Used by**: CLI subcommands (`init`, `update`, `quick-update`, `verify-quick-updates`) which load a flow and call `runFlow()`
- **External systems**: Filesystem (via `readFile` in `read-file.ts`), log file (`run.log` in the run directory)

## Extension Guide

To modify flow execution behavior:

- **Add a new step type**: Follow the [Adding Flow Primitives](../patterns/adding-flow-primitives.md) pattern
- **Override scripts in tests**: Pass a custom `scripts` map in `RunFlowDeps` to replace or extend `defaultScriptRegistry`
