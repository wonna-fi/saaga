---
generated: 2026-08-06T06:51:33Z
verified: false
docs_touched:
  - saaga-docs/concepts/agent-permissions.md
confidence: high
---

## What changed

`src/agent/permissions.ts` expanded `ALLOWED_SHELL_COMMANDS.utilities` from three entries (`cd`, `ls`, `pwd`) to ten entries (`cd`, `ls`, `pwd`, `grep`, `head`, `tail`, `wc`, `find`, `dirname`, `basename`). The companion test file was updated accordingly. No new exports or interfaces were added; this is a pure constant expansion.

## What was updated

- **`saaga-docs/concepts/agent-permissions.md`** — Updated two occurrences of the `utilities` command list in the Configuration section and the Key Services/Functions table to reflect the full expanded set: `cd`, `ls`, `pwd`, `grep`, `head`, `tail`, `wc`, `find`, `dirname`, `basename`.

## Uncertainty areas

None. The change is a straightforward constant expansion verified directly in the source file.
