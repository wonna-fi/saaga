---
generated: 2026-08-06T06:45:00Z
verified: false
docs_touched:
  - saaga-docs/concepts/agent-permissions.md
  - saaga-docs/features/doctor.md
confidence: high
---

## What Changed

The `"restricted"` shell policy was introduced in `src/agent/permissions.ts`, replacing the previous `"read-only-git"` policy name. The `READ_ONLY_GIT` constant was replaced by `ALLOWED_SHELL_COMMANDS`, which now groups allowed commands into two categories: `utilities` (`cd`, `ls`, `pwd`) and `git` read-only subcommands (unchanged). All three agent backends (`cursor-agent.ts`, `copilot-agent.ts`, `claude-agent.ts`) received corresponding comment-level or logic-level updates, and the `read-only-git-allowed` probe description in `src/doctor/probes.ts` was updated to reference "restricted shell allowance".

The behavioral change for Cursor is that utility commands (`cd`, `ls`, `pwd`) are now also granted under the restricted profile in addition to the git subcommands. Copilot and Claude still degrade to no shell under any restriction.

## What Was Updated

- **`saaga-docs/concepts/agent-permissions.md`**:
  - Business definition: updated to describe "safe utility commands and read-only git subcommands" instead of "read-only git subcommands"
  - Configuration section: replaced `READ_ONLY_GIT` reference with `ALLOWED_SHELL_COMMANDS` with its new structure
  - Data Storage table: `shell` field now shows `"none"` or `"restricted"` (was `"read-only-git"`)
  - Key Services/Functions table: replaced `READ_ONLY_GIT` entry with `ALLOWED_SHELL_COMMANDS` entry listing both `utilities` and `git` subcommands
  - Default Profile Grants: updated Shell line to "restricted (utilities + read-only git subcommands)"
  - Cursor Translation Details: updated step 4 to reference `ALLOWED_SHELL_COMMANDS.utilities` and `ALLOWED_SHELL_COMMANDS.git`
  - Copilot and Claude Translation Details: updated "read-only-git policy" wording to "restricted shell policy"

- **`saaga-docs/features/doctor.md`**:
  - Probe Catalogue table: updated `read-only-git-allowed` description from "read-only git allowance" to "restricted shell allowance"

## Uncertainty Areas

None. All changes were straightforward renames with clear source-code evidence. The behavioral expansion (adding `cd`, `ls`, `pwd` for Cursor) is directly visible in `cursor-agent.ts` lines 199–204.
