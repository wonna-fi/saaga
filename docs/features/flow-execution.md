# Feature: Flow Execution

## Overview

Flow execution is the core runtime process that takes a loaded `FlowDefinition` and runs each step sequentially. The runner dispatches steps by type, renders agent prompts, invokes scripts, evaluates predicates for control flow, and asserts expected file outputs.

## Key Concepts

Before working with this feature, understand these concepts:

- [Flow DSL](../concepts/flow-dsl.md)
- [Scope and Expressions](../concepts/scope-and-expressions.md)
- [Agent Interface](../concepts/agent-interface.md)
- [Templates and Prompt Rendering](../concepts/templates-and-prompt-rendering.md)

## Functional Specification

### Execution Flow

1. `runFlow()` receives a `FlowDefinition`, initial scope, and dependencies (`RunFlowDeps`)
2. Resolves a logger from `deps.logger` (falls back to a silent logger that writes to a no-op stream)
3. Logs flow start: `flow <name>: starting (<N> steps)`
4. Creates a shallow copy of the initial scope
5. Iterates through `flow.steps` sequentially
6. For each step, dispatches to the appropriate handler based on `step.type`; each step logs entry/exit with timing and positional info (`step N/M`)
7. Logs flow completion with elapsed time: `flow <name>: done (<duration>)`. On failure, logs `flow <name>: failed after <duration>` before re-throwing

### Step Dispatch Table

| Step Type | Handler | Behavior |
|-----------|---------|----------|
| `agent` | `runAgentStep()` (internal) | Resolves prompt template, interpolates vars, renders prompt, calls `Agent.run()`, asserts `expect_file`. Logs entry with prompt name and context vars, logs exit with timing. |
| `script` | `runScriptStep()` | Looks up script in registry, interpolates args, executes handler, optionally stores result in scope. Logs entry with script name, logs exit with timing. |
| `foreach` | `runForeachStep()` via `runForeachWithLogging()` | Resolves array from scope, logs item count, iterates with optional `when:` filter, dispatches child steps. Each iteration logs a banner with item details. Uses a child logger (indented) for the iteration body. |
| `loop` | `runLoopStep()` via `runLoopWithLogging()` | Repeats body up to `max` times, sets `${iteration}`, exits early when `until:` is true. Each iteration logs a banner. Uses a child logger (indented) for the iteration body. |
| `if` | `runIfStep()` | Evaluates condition predicate in the runner, logs the predicate result (`true` or `false (skip)`), executes `then:` body only if true. |
| `read-file` | `runReadFileStep()` | Reads file at interpolated path, stores contents in scope variable. Logs entry with path and target variable, logs exit with timing and value summary. |

### Agent Step Execution Detail

1. Resolves prompt file path: `<PROMPTS_DIR>/<step.prompt>.md`
2. Interpolates each `vars` value using `interpolate(raw, scope)` — resolves `${expr}` references
3. Renders the prompt template file: `renderPromptFile(path, renderedVars)` — substitutes `{key}` placeholders
4. Calls `deps.agent.run(prompt, { cwd: deps.cwd })`
5. If exit code is non-zero, throws `AgentStepFailedError`
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
import { Logger } from "../logger.js";

interface RunFlowDeps {
  agent: Agent;              // Backend for agent steps
  cwd: string;              // Working directory for agent invocations
  scripts?: ScriptRegistry;  // Override script registry (for tests)
  logger?: Logger;           // Structured logger for flow progress output (defaults to silent)
}
```

### Services/Functions

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/engine/runner.ts` | `runFlow()` | Main entry point: executes a flow definition with given scope and dependencies |
| `src/engine/runner.ts` | `RunFlowDeps` (interface) | Configuration for the execution environment |
| `src/engine/runner.ts` | `ExpectFileMissingError` (class) | Thrown when `expect_file` assertion fails |
| `src/engine/runner.ts` | `AgentStepFailedError` (class) | Thrown when an agent step exits with non-zero code |
| `src/engine/expression.ts` | `interpolate()` | Resolves `${var}` expressions in step vars, paths, and args |
| `src/engine/expression.ts` | `resolveValue()` | Resolves values preserving type (used by foreach for arrays) |
| `src/engine/expression.ts` | `evaluatePredicate()` | Evaluates conditions for loop/foreach/if |
| `src/engine/primitives/foreach.ts` | `runForeachStep()` | Handles foreach iteration with filtering and child dispatch |
| `src/engine/primitives/loop.ts` | `runLoopStep()` | Handles loop with max cap and until predicate |
| `src/engine/primitives/if.ts` | `runIfStep()` | Handles conditional execution |
| `src/engine/primitives/read-file.ts` | `runReadFileStep()` | Handles file reading into scope |
| `src/engine/primitives/script.ts` | `runScriptStep()` | Handles script lookup, arg interpolation, and result storage |
| `src/logger.ts` | `Logger` (class) | Structured leveled logger with `info()`, `warn()`, `error()`, and `child(extraIndent?)` for nested indentation |
| `src/logger.ts` | `LoggerOptions` (interface) | Configuration: `ci?`, `stream?`, `indent?` |

### Internal Implementation

> Functions below are internal to `src/engine/runner.ts` and should not be called directly. They are documented for understanding the logging and control-flow delegation logic.
>
> - `runStep()` — dispatches a single step by type, logs entry/exit with timing and position
> - `runForeachWithLogging()` — wraps `runForeachStep()` with per-iteration logging banners and nested child loggers
> - `runLoopWithLogging()` — wraps `runLoopStep()` with per-iteration logging banners and nested child loggers
> - `runAgentStep()` — resolves the prompt template, renders it, invokes the agent, and asserts `expect_file`
> - `indexIn()` — returns the 1-indexed `StepPosition` of a step within a sibling list
> - `describeAgentContext()` — extracts interesting vars (`phase_number`, `iteration`) for agent step log lines
> - `describeIterItem()` — summarizes the current iteration item (`.number`, `.title`, or scalar value) for foreach log lines
> - `summarizeValue()` — produces a compact string summary of a scope value (string length, array count, etc.)
> - `formatDuration()` — formats elapsed milliseconds as `Nms`, `N.Ns`, or `NmSSs`
> - `silentLogger()` — returns a singleton `Logger` that writes to a no-op `Writable` stream (used as the default when `deps.logger` is not provided)
> - `assertFileExists()` — asserts a path exists and is a file

## Integration Points

- **Depends on**: Agent backend (via `RunFlowDeps.agent`), template rendering (`renderPromptFile`), script registry (`defaultScriptRegistry`), expression engine (`interpolate`, `resolveValue`, `evaluatePredicate`), `Logger` (via `RunFlowDeps.logger`, optional)
- **Used by**: CLI subcommands (`architecture`, `init`, `update`, `quick-update`, `verify-quick-updates`, `slice`) which load a flow and call `runFlow()`
- **External systems**: Filesystem (via `readFile` in `read-file.ts`)

## Extension Guide

To modify flow execution behavior:

- **Add a new step type**: Follow the [Adding Flow Primitives](../patterns/adding-flow-primitives.md) pattern
- **Override scripts in tests**: Pass a custom `scripts` map in `RunFlowDeps` to replace or extend `defaultScriptRegistry`
