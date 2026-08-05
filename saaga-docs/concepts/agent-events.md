# Agent Events and Denial Parsing

## Business Definition

Agent events are structured messages parsed from a backend CLI's output stream during a restricted run. They provide machine-checkable evidence of permission decisions — most importantly, which tool calls were refused and why — rather than relying on model narration which varies between runs and is sometimes wrong about the cause. The audit system collects these denial events, classifies them against the permission profile, and writes a grouped summary that highlights actionable problems.

## Configuration

| Source | Description |
|--------|-------------|
| `AgentRunOpts.onEvent` | When set, the backend switches to structured output (NDJSON) and forwards parsed events to this callback |
| CLI flag `--audit-permissions` | Activates event parsing and creates a `PermissionAuditor` for the run |

**How to access:**
- `consumeEvents(stream, parser, sink)` — drives a parser over an async stream, forwarding events to the sink
- `LineSplitter` (class) — reassembles whole lines from arbitrarily chunked stream data
- `parseJsonLine(line)` — attempts to parse a line as JSON, ignoring non-JSON noise
- `createCursorEventParser()` — factory for the Cursor backend event parser
- `createCopilotEventParser()` — factory for the Copilot backend event parser
- `createClaudeEventParser()` — factory for the Claude backend event parser
- `PermissionAuditor` (class) — collects denial events, classifies them, writes the audit log

## Data Storage

| Object/Model/Type | Field/Property | Purpose |
|--------|-------|---------|
| `DenialEvent` | `kind` | Always `"denial"` — discriminant |
| `DenialEvent` | `tool` | Name of the tool that was refused, in the backend's own naming |
| `DenialEvent` | `path` | Absolute path the call targeted (optional; not all backends report it) |
| `DenialEvent` | `message` | Message emitted by the CLI (not by the model) |
| `SessionEvent` | `kind` | Always `"session"` — discriminant |
| `SessionEvent` | `tools` | The toolset the backend announced at session start |
| `ClassifiedDenial` | `event` | The original `DenialEvent` |
| `ClassifiedDenial` | `className` | The `DenialClass` assigned by classification |
| `ClassifiedDenial` | `resolvedPath` | Absolute form of the event's path, when one could be determined |
| `AuditResult` | `logPath` | Path to the written audit log file |
| `AuditResult` | `counts` | Record of `DenialClass` → count |
| `AuditResult` | `unexpected` | Array of denials classified as `"unexpected"` (indicates profile bugs) |

## Denial Classification

The `classifyDenial()` function places each denial against the permission profile:

| `DenialClass` | Meaning | Action |
|---------------|---------|--------|
| `"unexpected"` | Refused inside a directory the profile grants | Profile bug or backend drift; the run is silently degraded |
| `"out-of-workspace"` | Path is outside the workspace | Pass `--allow-dir <path>` if genuinely needed |
| `"protected-path"` | Deliberately withheld path | Working as intended |
| `"shell"` | A command rather than a path | Expected under every backend profile |
| `"unknown"` | No path recovered | Cannot be placed |

Classification priority:
1. Shell tool names (`bash`, `shell`, `terminal`, `run_terminal_cmd`) → `"shell"`
2. No path on the event → `"unknown"`
3. Path matches an explicit deny path → `"protected-path"`
4. Path inside a write root → `"unexpected"` (should have been allowed)
5. Path inside a read root (but not write root) → `"protected-path"` (write was refused correctly)
6. Otherwise → `"out-of-workspace"`

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `src/agent/events.ts` | `DenialEvent` (interface) | A tool call refused on permission grounds |
| `src/agent/events.ts` | `SessionEvent` (interface) | The toolset announced at session start |
| `src/agent/events.ts` | `AgentEvent` (type) | Discriminated union: `DenialEvent \| SessionEvent` |
| `src/agent/events.ts` | `AgentEventSink` (type) | Callback signature: `(event: AgentEvent) => void` |
| `src/agent/events.ts` | `EventParser` (interface) | Contract for backend-specific parsers: `push(line) → AgentEvent[]` |
| `src/agent/events.ts` | `LineSplitter` (class) | Reassembles whole lines from chunked stream data via `push(chunk)` and `flush()` |
| `src/agent/events.ts` | `parseJsonLine()` | Parses a line as JSON, returning `undefined` for non-JSON noise |
| `src/agent/events.ts` | `consumeEvents()` | Drives a parser over an async stream, forwarding each event to the sink |
| `src/agent/audit.ts` | `DenialClass` (type) | Union of classification labels: `"unexpected" \| "out-of-workspace" \| "protected-path" \| "shell" \| "unknown"` |
| `src/agent/audit.ts` | `ClassifiedDenial` (interface) | A denial event paired with its classification and resolved path |
| `src/agent/audit.ts` | `classifyDenial()` | Places a denial event against the permission profile, returning a `ClassifiedDenial` |
| `src/agent/audit.ts` | `AuditResult` (interface) | Output of an audit flush: log path, counts by class, unexpected denials |
| `src/agent/audit.ts` | `PermissionAuditor` (class) | Collects denial events via `record()`, classifies them, and writes a grouped summary via `flush()` |
| `src/agent/cursor-agent.ts` | `createCursorEventParser()` | Factory for parsing Cursor's `stream-json` tool_call completion output |
| `src/agent/copilot-agent.ts` | `createCopilotEventParser()` | Factory for parsing Copilot's JSONL output (correlates requests with `error.code: "denied"` responses) |
| `src/agent/claude-agent.ts` | `createClaudeEventParser()` | Factory for parsing Claude's `stream-json` output (matches denial patterns in `tool_result` errors) |
| `src/agent/spawn.ts` | `EventConsumer` (interface) | Pairs an `EventParser` with an `AgentEventSink` for `awaitProcess()` |
| `src/agent/spawn.ts` | `awaitProcess()` | Awaits a spawned process while concurrently draining its stdout through event parsing |
| `src/agent/stdio.ts` | `buildStdio()` | Builds execa stdio options for non-event-parsed runs (inherit or log file) |
| `src/agent/stdio.ts` | `buildPipedStdio()` | Builds execa stdio options that pipe stdout for event parsing |

## Event Parsing Pipeline

The event system forms a pipeline:

1. **stdio selection** — `buildPipedStdio()` pipes stdout so the parent process can read it
2. **process lifecycle** — `awaitProcess()` drains the stream concurrently with the child process to avoid pipe-buffer deadlocks
3. **line reassembly** — `LineSplitter` handles arbitrary chunk boundaries
4. **JSON extraction** — `parseJsonLine()` skips non-JSON output interleaved by backends
5. **backend-specific parsing** — each `EventParser` implementation understands its backend's structured output format
6. **event delivery** — each parsed event is forwarded to the `AgentEventSink`
7. **classification and auditing** — `PermissionAuditor.record()` classifies each denial as it arrives

## Per-Backend Parser Details

### Cursor (`createCursorEventParser`)

Parses `stream-json` output where refusals appear as `tool_call` completions with:
- `result.writePermissionDenied` — carries `{ path, error }`
- `result.rejected` — carries `{ command?, path?, reason, isReadonly? }`
- `result.error.errorMessage` containing "permission denied" — read-tool failures

### Copilot (`createCopilotEventParser`)

Parses JSONL output where:
- `assistant.message` events carry `toolRequests` with call IDs and arguments
- `tool.execution_complete` events carry `error.code: "denied"` correlated by call ID

The parser maintains a pending map of call IDs to recover the tool name and path from the original request.

### Claude (`createClaudeEventParser`)

Parses `stream-json` output where:
- `system` init events carry the announced `tools` array (emitted as `SessionEvent`)
- `tool_use` blocks carry the call ID, tool name, and input path
- `tool_result` blocks with `is_error: true` are matched against denial patterns

The parser maintains a pending map of call IDs and matches refusal messages against `CLAUDE_DENIAL_PATTERNS`.

## PermissionAuditor Lifecycle

1. **Construction** — receives the `AgentPermissions` profile, working directory, and log file path
2. **Recording** — `record(event)` is passed as the `AgentEventSink`; ignores non-denial events, classifies denials immediately
3. **Querying** — `unexpected` getter returns denials classified as `"unexpected"` (profile bugs)
4. **Flushing** — `flush()` writes the grouped audit log and returns `AuditResult`

The audit log groups entries by class, deduplicates repeated tool+target combinations (showing `(xN)` counts), and summarizes totals. Messages are truncated to 200 characters to avoid verbose Claude-style guidance text.

## Internal Implementation

> Functions below are internal and should not be called directly. They are documented for understanding the internal logic.
>
> - `src/agent/audit.ts`.`groupByTarget()` — folds repeated denials of the same tool and path into single entries with counts
> - `src/agent/audit.ts`.`summarize()` — truncates a CLI message to its first sentence (max 200 chars)
> - `src/agent/audit.ts`.`emptyCounts()` — creates a zeroed `Record<DenialClass, number>`
> - `src/agent/cursor-agent.ts`.`extractDeniedPath()` — regex extraction of path from "Write permission denied: /path: ..." messages

## Reference Implementations

- `src/agent/events.ts` — canonical event type definitions and the stream consumption driver
- `src/agent/audit.ts` — the full auditor lifecycle: classification logic, grouping, and log formatting
- `src/agent/cursor-agent.ts` — demonstrates the most complex event parser (three refusal shapes)
- `src/agent/copilot-agent.ts` — demonstrates request/response correlation via call IDs
- `src/agent/claude-agent.ts` — demonstrates pattern-matching on error messages and session tool announcements
- `src/agent/spawn.ts` — demonstrates concurrent stream draining to avoid pipe-buffer deadlocks

## Related Concepts

- [Agent Permissions and Restriction](./agent-permissions.md) — the profile that `classifyDenial()` evaluates against
- [Agent Interface](./agent-interface.md) — the `AgentRunOpts.onEvent` field that activates event parsing
