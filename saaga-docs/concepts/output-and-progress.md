# Output and Progress Display

## Business Definition

The output and progress system controls how Saaga communicates execution progress to the user on the terminal. Instead of verbose per-step `[INFO]` log lines, the system emits concise phase-progress lines of the form `Phase N/M: label [DONE] duration`. It supports TTY spinners for interactive terminals, column-aligned markers, log-file capture of all output, and a `--verbose` mode that shows additional detail lines.

## Configuration

| Source | Description |
|--------|-------------|
| `--verbose` CLI flag | Enables detailed output: shows `detail()` lines on the terminal and mirrors live agent output |
| `--ci` CLI flag | Disables color and TTY features (no spinner, plain `[DONE]`/`[SKIP]`/`[FAIL]` markers) |
| `logFile` (passed via `RunFlowDeps`) | Absolute path to a log file; all output is appended here regardless of verbosity |

**How to access:**

- `new OutputSink(opts)` — constructs the output backend with TTY detection, marker column, and optional log file
- `Logger.fromSink(sink, opts)` — creates a `Logger` wrapping an existing `OutputSink` (shared state)
- `new Logger(opts)` — creates a `Logger` that internally creates its own `OutputSink`

## Data Storage

| Object/Model/Type | Field/Property | Purpose |
|--------|-------|---------|
| `OutputSinkOptions` | `ci` | When `true`, disables color and TTY features |
| `OutputSinkOptions` | `stream` | Writable stream for output (defaults to `process.stderr`) |
| `OutputSinkOptions` | `logFile` | Absolute path to append all output to |
| `OutputSinkOptions` | `verbose` | When `true`, shows detail lines on terminal and emits phase text before markers |
| `Marker` | — | String literal union: `"DONE"`, `"SKIP"`, `"FAIL"`, or `"PASS"` |
| `LoggerOptions` | `ci` | Passed through to `OutputSink` |
| `LoggerOptions` | `stream` | Passed through to `OutputSink` |
| `LoggerOptions` | `indent` | Spaces prepended to log lines for nested context (default `0`) |
| `LoggerOptions` | `logFile` | Passed through to `OutputSink` |
| `LoggerOptions` | `verbose` | Passed through to `OutputSink` |

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/output.ts` | `OutputSink` (class) | Core output backend: manages pending-line state, TTY spinner, column-aligned markers, and log-file append |
| `src/output.ts` | `OutputSinkOptions` (interface) | Configuration for `OutputSink`: `ci?`, `stream?`, `logFile?`, `verbose?` |
| `src/output.ts` | `Marker` (type) | String literal union: `"DONE" \| "SKIP" \| "FAIL" \| "PASS"` |
| `src/output.ts` | `formatDuration()` | Formats elapsed milliseconds: `<1s` → `Nms`, `<60s` → `N.Ns`, `≥60s` → `NmSSs` |
| `src/output.ts` | `truncateLabel()` | Truncates a phase label to fit within the marker column, preserving prefix and suffix |
| `src/logger.ts` | `Logger` (class) | Facade over `OutputSink` with `phaseBegin()`, `phaseEnd()`, `phaseImmediate()`, `detail()`, `info()`, `warn()`, `error()`, `logFileSize()`, `tailLog()`, `getSink()`, `child()`, `dispose()` |
| `src/logger.ts` | `LoggerOptions` (interface) | Configuration for `Logger`: `ci?`, `stream?`, `indent?`, `logFile?`, `verbose?` |
| `src/logger.ts` | `Logger.fromSink()` (static method) | Creates a `Logger` wrapping an existing `OutputSink` for shared state |
| `src/logger.ts` | `silentLogger()` | Returns a singleton `Logger` that writes to a no-op stream (used as default when no logger is provided) |
| `src/engine/phases.ts` | `PhaseTracker` (class) | Tracks the flat phase index and dynamically computes the total for `Phase N/M` display |

## Terminal Output Contract

### Phase Lines

The primary output unit is the **phase line**. Each phase line has the format:

```
Phase N/M: label                                        [DONE] 1.2s
```

Components:
- **Counter** (`Phase N/M`): `N` is the current phase (1-indexed), `M` is the dynamically computed total (or `?` if not yet determinable)
- **Label**: human-readable description from the step's `label` field (or derived from step name); interpolated against scope
- **Marker**: `[DONE]`, `[SKIP]`, `[FAIL]`, or `[PASS]` — column-aligned to `markerCol` (default column 72, adapts to terminal width, minimum column 40)
- **Duration**: formatted elapsed time appended after the marker

### Markers

| Marker | Meaning | Color (TTY) |
|--------|---------|-------------|
| `[DONE]` | Phase completed successfully | Green |
| `[PASS]` | Phase passed verification (semantically equivalent to DONE) | Green |
| `[SKIP]` | Phase was skipped (e.g. `if` condition was false) | Dim |
| `[FAIL]` | Phase failed with an error | Red |

### TTY Spinner

On interactive terminals (TTY), while a phase is in progress:
- The pending line is displayed with a braille spinner animation (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) cycling every 120ms
- Elapsed time is shown alongside the spinner in dim text
- When the phase completes, the spinner line is replaced with the final phase line (using `\r\x1b[K` to clear)

On non-TTY streams (e.g., CI, pipes):
- Phase text is written immediately without a spinner
- The marker and duration are appended on the same line when the phase completes

### Verbose Mode

When `--verbose` is enabled:
- `detail()` messages appear on the terminal (indented with two spaces)
- Phase begin text is written on its own line (no spinner)
- Phase end marker is written on a separate line
- Agent output is mirrored to the terminal via `echo: true` in `AgentRunOpts`

### Log File

All output is always appended to the log file (`run.log` in the run directory), regardless of verbosity:
- Phase begin/end lines (with plain-text markers, no ANSI colors)
- Detail messages
- `[INFO]`, `[WARN]`, `[ERROR]` tagged lines

## Phase Tracking

The `PhaseTracker` class dynamically counts phases for the `N/M` display:

| Method | Purpose |
|--------|---------|
| `advance()` | Increment the phase counter; returns the new 1-indexed number |
| `recordIfOutcome()` | Record whether an `if` step was taken or skipped (affects total count) |
| `total()` | Compute the total phase count given current scope; returns `null` when indeterminate |
| `formatCounter()` | Format as `Phase N/M` or `Phase N/?` |

### Phase Counting Rules

| Step Type | Phases Counted |
|-----------|---------------|
| `agent` | 1 |
| `script` | 1 |
| `foreach` | Number of surviving items (after `when` filter) |
| `if` (taken) | Count of phases in the `then` body |
| `if` (skipped) | 1 (the `[SKIP]` line itself) |
| `read-file` | 0 (plumbing, no phase line) |
| `loop` | 0 (plumbing, no phase line; child steps emit their own phases) |

> **Note:** Steps nested inside a `foreach` body share their parent's phase index — `advance()` is called once for the first child step in each iteration. Steps nested inside a `loop` do not advance the phase counter independently; they use the enclosing context.

## Internal Implementation

> Functions below are internal and should not be called directly. They are documented for understanding the internal logic.
>
> - `OutputSink.computeMarkerCol()` — calculates the marker column based on terminal width
> - `OutputSink.padToMarker()` — pads or truncates text to align with the marker column
> - `OutputSink.renderMarker()` — renders a `Marker` with ANSI colors (or plain in CI/non-TTY)
> - `OutputSink.startSpinner()` / `OutputSink.stopSpinner()` — manages the TTY braille spinner interval
> - `OutputSink.interruptPending()` — handles `warn()`/`error()` arriving while a phase is pending
> - `OutputSink.finishPendingLine()` — clears a pending phase line before starting a new one
> - `OutputSink.logDetail()` — appends a line to the log file (best-effort)
> - `stripAnsi()` in `src/output.ts` — removes ANSI escape codes for width calculations
> - `truncateText()` in `src/output.ts` — truncates phase lines preserving iteration suffixes
> - `silentSink()` in `src/logger.ts` — returns a singleton `OutputSink` writing to a no-op stream

## Reference Implementations

- `src/output.ts` — `OutputSink` class and all output formatting utilities
- `src/engine/phases.ts` — `PhaseTracker` class for dynamic phase counting
- `src/logger.ts` — `Logger` facade over `OutputSink` with `fromSink()` factory and `child()` for nested indentation
- `src/engine/runner.ts` — consumer of `PhaseTracker` and `Logger`: emits phase lines during flow execution

## Related Concepts

- [Flow DSL](./flow-dsl.md)
- [Agent Interface](./agent-interface.md)
- [Flow Definitions](./flow-definitions.md)
