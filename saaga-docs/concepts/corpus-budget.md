---
title: Corpus Budget
type: concept
last_verified: 2026-10-05
sources:
  - src/docs/corpus-budget.ts
  - src/docs/validate.ts
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
skipped rather than followed, and an unreadable file is passed over.

The extension list is code only — `.yaml` is deliberately absent, because a lock file or a
CI matrix would raise the ceiling far more than it adds documentable domain. A test path is a
test-shaped directory (`tests/`, `spec/`, `__tests__/`, …) or a test-shaped filename in any
of the four conventions the majors use, so test volume cannot buy a bigger corpus. An
unrecognised stack measures zero — which would pass every plan — so that case is reported as
its own reason rather than as an ordinary pass.

### The ceilings

`deriveCeilings()` computes `lines / SOURCE_LINES_PER_DOC` documents (420 source lines per
document) and `lines × DOC_LINES_PER_SOURCE_LINE` doc-lines (0.25), each rounded and then
raised to at least `MIN_DOC_CEILING` (8) and `MIN_LINE_CEILING` (400). Zero source lines give
ceilings of zero, which the check treats as "no ceiling applies".

### Reading the roster

`parsePlannedDocs()` takes the union of three line shapes, because none is complete alone:
budget lines (`<path> — <Tier>, <n> lines`), ownership lines (`<path> — owns:`), and
deliverable lines that *lead* with exactly one `.md` path and carry no `owns:`/`references:`.
Fenced blocks and generated `INDEX.md`, `README.md` and `GLOSSARY.md` are never rostered. A
budget without a tier counts only for `ARCHITECTURE.md`; elsewhere it is ignored, leaving the
document unbudgeted. A bare basename merges into the one qualified path sharing it, and is
reported `ambiguous-path` when several do.

### What a document is charged

A **tier** states centrality, not source size; its band comes from the level-of-detail policy
the planning prompts carry: Core 100–200 lines, Supporting 60–120, Peripheral 25–60. `docCost()` charges:

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

`checkPlanBudget()` returns `PASS`, `OVER` or `UNPARSEABLE`, plus its reasons:
`over-doc-count` and `over-line-budget` make a plan `OVER`; `empty-roster` and
`one-sided-roster` mean the gate could not read the plan's decisions, which is `UNPARSEABLE`
because an unchecked plan must not pass silently; `no-measurable-source` passes but says so.
Those three are each returned alone, while `unbudgeted`, `missing-ownership`, `below-tier`
and `ambiguous-path` accompany `PASS` or `OVER`. Acting on a report belongs to
[corpus gates](../features/corpus-gates.md).

## Reference Implementations

- `src/docs/corpus-budget.ts` - the measurement, the ceilings, the plan parser, the verdict
- `tests/docs/corpus-budget.test.ts` - the charging rules and the roster parser, case by case

## Related Concepts

- [Corpus Documents](./corpus-documents.md)
- [Baseline and Change Detection](./baseline-and-change-detection.md)
- [Feature: Corpus Gates](../features/corpus-gates.md)
- [Feature: Init Workflow](../features/init-workflow.md) — the replan loop a rejected plan enters
