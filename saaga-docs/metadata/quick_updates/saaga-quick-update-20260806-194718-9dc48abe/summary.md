---
generated: 2026-08-06T19:47:18Z
verified: false
docs_touched:
  - saaga-docs/concepts/agent-permissions.md
  - saaga-docs/concepts/agent-interface.md
  - saaga-docs/features/doctor.md
  - saaga-docs/patterns/adding-agent-backends.md
  - saaga-docs/ARCHITECTURE.md
confidence: high
---

## What changed

Commit `ce1e4d6` ("enable claude restricted shell via scoped Bash allow/deny rules") changes `src/agent/claude-agent.ts`, `src/agent/permissions.ts`, `src/doctor/probes.ts`, and `src/doctor/full-probes.ts`:

- Claude's restricted profile no longer denies `Bash` outright. When `AgentPermissions.shell === "restricted"`, `buildClaudeSettings()` now emits scoped `Bash(<command>:*)` / `Bash(git <subcommand>:*)` allow rules for every entry in `ALLOWED_SHELL_COMMANDS`, paired with explicit denies (`CLAUDE_BUILTIN_BASH_DENY`) for Claude's built-in read-only Bash commands that bypass `permissions.allow` under `--permission-mode dontAsk` (`cat`, `echo`, `find`, `which`, `diff`, `stat`, `du`, `sha256sum`, `md5sum`, `python`, `python3`, `uname`, `date`, `env`). A bare `Bash` deny is now only emitted when `shell === "none"`.
- `CLAUDE_RESTRICTED_TOOLS` (the expected tool surface asserted by the `claude/tool-surface` doctor probe) changed from `["Edit", "Glob", "Grep", "Read", "Write"]` to `["Bash", "Edit", "Read", "Write"]` — `Bash` added, `Glob`/`Grep` dropped.
- The `restricted-shell-utility-allowed`, `read-only-git-allowed`, and `git-mutation-denied` doctor probes are now scoped to `["cursor", "copilot", "claude"]` (previously `["cursor", "copilot"]`/`["cursor"]`), and the `claude/tool-surface` probe description was reworded to mention Bash.
- README.md already documents this change itself (part of the same commit), so it was not modified here.

## What was updated

- `saaga-docs/concepts/agent-permissions.md` — rewrote the "Claude Translation Details" section to describe scoped `Bash(...)` allow/deny rules instead of "degrades to no shell"; added `restrictedBashAllowRules()` and `CLAUDE_BUILTIN_BASH_DENY` to Internal Implementation; fixed the Backend Translation table's Copilot restricted-mode cell (`--allow-all-tools` is not actually passed in restricted mode) and the "Copilot Translation Details" section (Copilot has honored the restricted shell policy via `shell(...)` allow rules since an earlier, already-documented commit — this section had not caught up).
- `saaga-docs/concepts/agent-interface.md` — updated the `ClaudeAgent` and `CopilotAgent` reference-implementation bullets to describe the scoped shell allow/deny behavior instead of "no shell"; updated the `CLAUDE_RESTRICTED_TOOLS` table entry to `Bash, Edit, Read, Write`.
- `saaga-docs/features/doctor.md` — added the missing `restricted-shell-utility-allowed` row to the Probe Catalogue table and widened the `backends` column for `read-only-git-allowed`/`git-mutation-denied` to `cursor, copilot, claude`; updated the `claude/tool-surface` description to mention Bash.
- `saaga-docs/patterns/adding-agent-backends.md` — updated the Reference Implementations table so Cursor/Copilot/Claude rows all describe honoring the restricted shell policy (previously claimed Cursor was the only backend that could, and Copilot had none).
- `saaga-docs/ARCHITECTURE.md` — updated the `CopilotAgent` and `ClaudeAgent` restricted-mode prose and the `CLAUDE_RESTRICTED_TOOLS` mention to match current behavior; added `restricted-shell-utility-allowed` to the probe catalogue list.

## Uncertainty areas

- The `Glob`/`Grep` removal from `CLAUDE_RESTRICTED_TOOLS` is documented as observed fact (verified directly against the diff and current source), but the commit doesn't explain *why* they were dropped — I did not find a comment justifying it, so if a future session needs the rationale it isn't captured in the code comments either.
- While fixing the Claude-related sections in `agent-permissions.md`, `agent-interface.md`, `adding-agent-backends.md`, and `ARCHITECTURE.md`, I also corrected several **pre-existing** stale claims about Copilot's shell support (e.g. "Shell is removed entirely (no middle ground)", `--allow-all-tools` in restricted mode) that predate this change's baseline — that Copilot behavior was introduced in an earlier commit (`fba7e01`) whose own doc update apparently missed these files. These fixes are correct per current source but are outside the strict diff for this run, flagging in case `verify-quick-updates` wants to double check them.
- `saaga-docs/concepts/INDEX.md` still describes `agent-permissions.md` as covering `READ_ONLY_GIT` (the constant is actually named `ALLOWED_SHELL_COMMANDS`) — this mismatch predates this change and was left as-is since it's unrelated to the current diff.
