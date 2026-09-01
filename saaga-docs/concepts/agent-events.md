---
title: Agent Events
type: concept
sources:
  - src/agent/events.ts
  - src/agent/audit.ts
  - src/agent/claude-agent.ts
  - src/agent/copilot-agent.ts
  - src/agent/cursor-agent.ts
  - src/cli.ts
terms:
  - AgentEvent
  - denial
  - denial class
  - permission auditor
last_verified: 2026-09-01
---

# Agent Events

## Business Definition

The normalized facts Saaga extracts from a backend while it runs: which tool calls were
refused, which toolset the session opened with, and what it cost. Every backend can be asked
for newline-delimited JSON instead of prose, and each has a parser turning its dialect into
the same three event kinds. The point is not tidier output — it is that a refusal is reported
by the CLI's own code rather than narrated by the model, whose narration varies and is
sometimes wrong: copilot once blamed "/etc requires root privileges" for its own refusal.

## Data Storage

| Type | Field/Property | Purpose |
|--------|-------|---------|
| `DenialEvent` | `tool`, `path?`, `command?`, `message` | A refused call, in the backend's own tool naming, with whatever target it disclosed |
| `SessionEvent` | `tools` | The toolset announced when the session opened |
| `UsageEvent` | `turns?`, `inputTokens?`, `outputTokens?`, `cacheReadTokens?`, `cacheCreationTokens?`, `costUsd?`, `durationMs?` | Totals reported at session end; all optional, because the terminal message's shape varies by CLI version |
| `ClassifiedDenial` | `event`, `className`, `resolvedPath?` | A denial placed against the [profile](./agent-permissions.md) |

## Key Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `agent/events` | `AgentEvent`, `AgentEventSink`, `EventParser` | The event union, the callback, and the incremental parser contract |
| `agent/events` | `consumeEvents()` | Drive a parser over a stream and forward every event to a sink |
| `agent/events` | `LineSplitter`, `parseJsonLine()` | Reassemble whole lines from chunks; decode one, tolerantly |
| `agent/{claude,copilot,cursor}-agent` | `createClaudeEventParser()`, `createCopilotEventParser()`, `createCursorEventParser()` | One parser per backend dialect |
| `agent/audit` | `classifyDenial()`, `DenialClass` | Place a denial against the profile |
| `agent/audit` | `PermissionAuditor`, `AuditResult` | Collect denials over a run and write the classified summary |

### Parsing

A parser takes one line at a time and returns what that line yielded; claude and copilot
report a refusal by call id only, so both remember tool calls to recover its target. Output
that is not an event is simply not one — `parseJsonLine()` ignores any line that does not
start with `{` or does not parse, so interleaved prose is skipped rather than failing the run.
What marks a refusal differs: claude a message pattern, since it flags refusals with the same
`is_error` as ordinary tool failures; copilot `error.code: "denied"`; cursor three shapes.

### Denial classes

The useful question about a refusal is not its wording but which path it hit, so every class
compares that path to the roots in the profile. Shell tools are matched by name and never
resolved; a relative path resolves against the app path, because copilot reports relative ones.

| Class | Meaning |
|---|---|
| `unexpected` | Refused inside a root the profile grants. A Saaga bug or backend drift; the run was silently degraded, so the CLI warns about each one |
| `out-of-workspace` | The agent wanted a path outside every granted root. `--allow-dir <path>` is the fix if it genuinely needs it |
| `protected-path` | Refused a path the profile deliberately withholds — an explicit `denyPaths` entry, or a readable-but-not-writable source file |
| `shell` | A command rather than a path. Expected under every profile |
| `unknown` | No path was reported, so the denial cannot be placed |

An explicit deny wins over the roots, being the more specific statement even when the path
sits inside a granted tree. The auditor groups entries by class and by tool-plus-target,
folding repeats into one line so a retried write cannot bury the one entry worth reading;
[the CLI](../features/cli-entry-point.md) reports the counts and every `unexpected` entry.

## Reference Implementations

- `src/agent/audit.ts` - classification, grouping, and the summary's layout
- `src/agent/cursor-agent.ts` - `createCursorEventParser()`, the messiest of the three
- `tests/agent/events.test.ts`, `tests/agent/audit.test.ts` - captured output per backend,
  and each class with the grouped log a run produces

## Related Concepts

- [Agent Permissions](./agent-permissions.md)
- [Agent Interface](./agent-interface.md)
- [Feature: Doctor](../features/doctor.md) — the probes that assert on this stream
