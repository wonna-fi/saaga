---
generated: 2026-08-21T01:07:00Z
verified: false
docs_touched:
  - saaga-docs/concepts/agent-events.md
  - saaga-docs/ARCHITECTURE.md
confidence: high
---

## What changed

Commit `fix(audit): show distinct pathless shell denials separately (#40)` updated the permission-audit pipeline so shell denials carry an optional `command` on `DenialEvent`, and the audit log groups shell refusals by that command instead of collapsing all pathless shell denials into one entry. Cursor, Copilot, and Claude event parsers now extract and forward `command` when the backend reports it. Test-only files were ignored for documentation purposes.

## What was updated

- `saaga-docs/concepts/agent-events.md` — Documented `DenialEvent.command`; updated PermissionAuditor grouping/display behavior (command-based fold for shell denials, flatten/truncate, `(no command reported)`); noted command extraction in Cursor/Copilot/Claude parsers; expanded Internal Implementation for `targetOf`, `describeTarget`, `flattenCommand`, and revised `groupByTarget`.
- `saaga-docs/ARCHITECTURE.md` — Noted optional `command` on `DenialEvent` and command-keyed shell grouping in `PermissionAuditor`.

## Uncertainty areas

None material. Grouping/display behavior is covered by unit tests in `tests/agent/audit.test.ts` and matches `src/agent/audit.ts`. Shallow git history prevented recovering the pre-change file blobs; the update was inferred from the current source plus the fix commit message and tests.
