---
title: Corpus Budget
type: concept
last_verified: 2026-09-01
sources:
  - src/docs/corpus-budget.ts
  - prompts/partials/lod-policy.md
terms:
  - ceiling
  - tier
  - line budget
  - charged lines
---

# Corpus Budget

## Business Definition

A corpus is only useful if a reader can hold it. The **corpus budget** turns that into two
numbers derived from the repository itself — how many documents a plan may author, and how
many lines those documents may total — and measures a generated plan against them before
any of it is written.

The numbers are computed from the source, never read from the plan. A plan may state its
own totals, but a gate trusting them would be enforcing the planner's opinion of the budget
rather than the budget.

## Key Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `docs/corpus-budget` | `measureSource()` | Count in-scope source files and lines |
| `docs/corpus-budget` | `deriveCeilings()` | Turn a measurement into the two ceilings |
| `docs/corpus-budget` | `parsePlannedDocs()`, `normalizeDocPath()` | Read the roster of documents a plan authors |
| `docs/corpus-budget` | `checkPlanBudget()` | Decide a roster against the ceilings |
| `docs/corpus-budget` | `docCost()`, `isBelowTier()` | What one planned document is charged |
| `docs/corpus-budget` | `countNonZeroPhases()` | The plan's declared domain phases, read independently of `parse-plan` |
| `docs/corpus-budget` | `isSourceFile()`, `isTestPath()` | The measurement's inclusion rules |
| `docs/corpus-budget` | `BudgetReport`, `PlannedDoc`, `Ceilings`, `SourceMeasurement` | The report and its inputs |

### Measuring the source

The measurement walks the same
[in-scope file list](./baseline-and-change-detection.md) the baseline does, keeping files
whose extension is in `SOURCE_EXTENSIONS` and whose path is not a test path. Symlinks are
skipped rather than followed, and an unreadable file is passed over: neither contributes to
a ceiling either way.

The extension list is code only — `.yaml` is deliberately absent, because on a repository
that has not ignored them a lock file or a CI matrix would raise the ceiling far more than
it adds documentable domain. A test path is a test-shaped directory (`tests/`, `spec/`,
`__tests__/`, …) or a test-shaped filename in any of the four conventions the majors use,
so test volume cannot buy a bigger corpus. An allowlist always trails some language, and an
unrecognised stack measures zero — which would pass every plan — so that case is reported
as its own reason rather than as an ordinary pass.

### The ceilings

`deriveCeilings()` computes `lines / SOURCE_LINES_PER_DOC` documents (420 source lines per
document) and `lines × DOC_LINES_PER_SOURCE_LINE` doc-lines (0.25), each floored at
`MIN_DOC_CEILING` (8) and `MIN_LINE_CEILING` (400) so that a small project is not handed an
unusable budget. A repository measuring zero source lines gets ceilings of zero, which the
check then treats as "no ceiling applies" rather than as a plan that fails everything.

### What a document is charged

A **tier** is a statement about centrality, not about source size, and each tier's band
comes from the level-of-detail policy the planning prompts carry: Core 100–200 lines,
Supporting 60–120, Peripheral 25–60. A plan records a tier and an exact number per document.
`docCost()` charges:

| Case | Charged |
|------|---------|
| A convention document | The convention body cap (20), and it needs no budget line |
| A document with no budget | `UNBUDGETED_CHARGE` (200) — the Core band's ceiling, because an unbudgeted document cannot be assumed small |
| A budget below its declared tier's floor | The floor: Core 100, Supporting 60, Peripheral 25 |
| Anything else | The number the plan assigned |

The last two rules close the two ways a ceiling could otherwise be met by editing numbers
instead of cutting documents. `ARCHITECTURE.md` is added to the roster whether or not the
plan mentions it, because it is written before the plan exists and is on disk regardless.

### Statuses and reasons

`checkPlanBudget()` returns `PASS`, `OVER` or `UNPARSEABLE`, plus every reason it found:
`over-doc-count` and `over-line-budget` are the two that make a plan `OVER`;
`empty-roster` and `one-sided-roster` mean the gate could not read the plan's decisions at
all, which is `UNPARSEABLE` because a plan that was never checked must not pass silently;
`no-measurable-source` passes but says so; and `unbudgeted`, `missing-ownership`,
`below-tier` and `ambiguous-path` are reported alongside whatever the status is. Acting on
a report — reporting inside a retry loop, or failing after it — belongs to
[corpus gates](../features/corpus-gates.md).

## Reference Implementations

- `src/docs/corpus-budget.ts` - the measurement, the ceilings, the plan parser, the verdict
- `tests/docs/corpus-budget.test.ts` - the charging rules and the roster parser, case by case

## Related Concepts

- [Corpus Documents](./corpus-documents.md)
- [Baseline and Change Detection](./baseline-and-change-detection.md)
- [Feature: Corpus Gates](../features/corpus-gates.md)
- [Feature: Init Workflow](../features/init-workflow.md) — the replan loop a rejected plan enters
