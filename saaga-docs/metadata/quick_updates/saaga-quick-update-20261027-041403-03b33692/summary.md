---
generated: 2026-10-27T04:20:00Z
verified: false
docs_touched:
  - saaga-docs/concepts/script-registry.md
  - saaga-docs/features/init-workflow.md
  - saaga-docs/features/corpus-gates.md
confidence: medium
---

**What changed**: `init` gained two scripts, `ensure-docs-dirs` (create/prune category folders) and `check-planned-docs` (fails if planned documents are missing before the baseline). `readFormatVersion` now treats empty category folders as no corpus. Prompts were adjusted so phase 0 no longer creates folders.

**What was updated**: script-registry built-ins table; init-workflow steps, phase 0 note and edge cases; corpus-gates init gate list and the empty-docs-dir row.

**Uncertainty**: init-workflow.md step 9 now bundles several tail steps. The prompt changes in `document-architecture.md` were not inspected. `corpus-gates.md` may deserve a fuller description of `check-planned-docs`.
