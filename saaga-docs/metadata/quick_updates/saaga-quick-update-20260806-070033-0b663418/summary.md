---
generated: 2026-08-06T07:05:00Z
verified: false
docs_touched:
  - saaga-docs/concepts/agent-permissions.md
confidence: high
---

## What changed

`src/agent/permissions.ts` had `find` removed from the `ALLOWED_SHELL_COMMANDS.utilities` array (commit `b43e063 remove find command from the allowlist`). The test file and README were updated in the same commit. This is a public-API change to an exported constant that is explicitly documented.

## What was updated

- **`saaga-docs/concepts/agent-permissions.md`** — Removed `find` from the `ALLOWED_SHELL_COMMANDS` utility list in two places: the Configuration section prose description and the Key Services/Functions table entry.

## Uncertainty areas

None. The change is a single-entry removal from an exported constant with a clear commit message. The source code, test, and README all agree on the new list.
