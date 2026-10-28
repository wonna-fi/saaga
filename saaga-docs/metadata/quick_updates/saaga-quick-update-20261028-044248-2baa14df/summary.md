---
generated: 2026-10-28T04:50:00Z
verified: false
docs_touched:
  - saaga-docs/concepts/corpus-budget.md
confidence: medium
---

**What changed**: The deliverable scan in `src/docs/corpus-budget.ts` now rosters only corpus paths. `isCategoryDoc` moved there from `src/scripts/check-planned-docs.ts`. Tests were updated.

**What was updated**: `concepts/corpus-budget.md`, "Reading the roster". I added the corpus-path restriction and the shared `isCategoryDoc()` rule.

**Uncertainty**: I read only the grep output for `src/docs/corpus-budget.ts`, around lines 258-411, not the full diff. The `docs/` prefix variants are not described in the doc. `saaga-docs/concepts/script-registry.md` may mention `isCategoryDoc` in `check-planned-docs`. I did not check it.
