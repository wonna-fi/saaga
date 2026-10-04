---
generated: 2026-10-04T05:00:00Z
verified: false
docs_touched:
  - saaga-docs/concepts/agent-permissions.md
  - saaga-docs/features/doctor.md
confidence: medium
---

**What changed**: The codex agent now probes for its own native binary (`probeCodexExecutable()`) and grants that single file read access in the restricted sandbox. The doctor's `restricted-shell-utility-allowed` probe now uses `ls -i`, and codex was added to the backend lists of several probes.

**What was updated**:
- `concepts/agent-permissions.md`: the codex row in the per-backend table now mentions the executable read grant, and `probeCodexExecutable()` has a row in the Key Services table.
- `features/doctor.md`: the probe table now lists codex for the source/rule-file/BASELINE denial probes. The restricted-shell row now says "all five" backends and describes the `ls -i` and tree-hash assertions.

**Uncertainty**:
- I could not run git commands, so the changes were read from the current source and not from a diff.
- `doctor.md` Mechanism step 1 still says "all four" backends, and its `--backend` description may need a codex-aware fix. I did not verify this.
- Test-only changes were not documented.
