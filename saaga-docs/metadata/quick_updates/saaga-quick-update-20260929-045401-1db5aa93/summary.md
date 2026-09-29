---
generated: 2026-09-29T05:00:00Z
verified: false
docs_touched:
  - saaga-docs/concepts/backend-resolution.md
  - saaga-docs/concepts/agent-interface.md
  - saaga-docs/concepts/agent-permissions.md
confidence: medium
---

## What changed

A fifth backend, `codex`, was added: `CodexAgent` (`src/agent/codex-agent.ts`), a PreToolUse hook script (`src/agent/codex-hook.ts`), and wiring in `src/cli/backend.ts` and the doctor's required flags.

## What was updated

- `backend-resolution.md`: backend union, CLI command map and `createAgent()` row now include codex and its `fast` option.
- `agent-interface.md`: codex row in the backend table, Key Services row, `sources` entry, "five backends" wording.
- `agent-permissions.md`: codex row in the per-backend translation table, `sources` entries.

## Uncertainty areas

- I couldn't run shell commands (Bash was denied), so I did not read `src/cli.ts`. No CLI flag for `fast` is documented. `cli-entry-point.md` may need one.
- I did not update `doctor.md`, `agent-events.md`, `project-configuration.md`, `patterns/adding-agent-backends.md` or `ARCHITECTURE.md`. They likely still say "four backends" or lack codex. The same goes for the doctor `codex` probes in `full-probes.ts`, `probes.ts` and `index.ts`, and for the `corpus-budget.ts` and `run-manifest.ts` changes.
- `agent-events.md` needs codex's denial and usage parsing (`createCodexEventParser`).
- The codex row in the permissions table is derived from `codex-agent.ts`. I only read the start of `codex-hook.ts`.
