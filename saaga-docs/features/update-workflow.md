---
title: "Feature: Update Workflow"
type: feature
sources:
  - flows/update.flow.yaml
  - prompts/plan-update.md
  - src/scripts/detect-changes.ts
  - src/scripts/parse-plan.ts
terms:
  - update plan
  - diff budget
---

# Feature: Update Workflow

## Overview

`saaga run update` re-documents only what changed: it diffs the repository against the
recorded baseline, plans one phase per change group, and rewrites those slices with the
same verification the initial run used.

## Key Concepts

Before working with this feature, understand these concepts:
- [Baseline and Change Detection](../concepts/baseline-and-change-detection.md)
- [Flow Definitions](../concepts/flow-definitions.md)

## Functional Specification

### Mechanism

`flows/update.flow.yaml` in order:

1. `check-format-version` in `mode: update` — an update refuses a corpus whose stamp does
   not match this build. See [Corpus Gates](./corpus-gates.md).
2. `detect-changes` writes a markdown changes report into the run directory and binds its
   result to `changes`. The flow reads two of its fields: `count` and `changes_path`.
3. **The no-changes short circuit.** Everything after this point sits inside an `if` on
   `'${changes.count} != 0'`, carrying `label: updating documentation` and
   `skip_label: no changes detected`. When nothing changed the flow prints one `[SKIP]`
   line and ends — no plan, and no baseline, navigation or validation either, because
   there is nothing whose state they would need to catch up with.
4. `plan-update` writes the plan to
   `${run_dir}/plans/${app}-update-${date}.plan.md`, held to it by `expect_file`. It is
   given `changes_path` rather than the change set itself.
5. `parse-plan` binds the plan's `phases` array to scope.
6. A `foreach` over `${phases}` runs, per phase, a `slice-doc` agent step and then the
   verify/fix loop — the same three-step skeleton, with the same `max: 3` bound and the
   same `${run_dir}/slice-${phase.number}/` artifacts, that
   [Init Workflow](./init-workflow.md) describes.
7. `generate-baseline`, `generate-navigation`, `validate-docs`.

### How an update plan differs from an init plan

Both are parsed by the same `parse-plan` step and consumed by the same `slice-doc` prompt,
so the frontmatter contract is identical. What differs is how `plan-update` arrives at it:

- It **triages first**. If no documented surface is affected by the detected changes, it
  writes `phases: []` with a `## Decision` section citing each changed file and why it is
  not doc-worthy.
- It works to a **diff budget** rather than a corpus budget. Under roughly five changed
  source files, corrections are unlimited but at most one or two documents may get
  *longer* and no new document is created unless the change introduces a genuinely new
  concept; at five or more, normal planning applies. There is no
  [corpus-budget](../concepts/corpus-budget.md) gate in this flow, because an update is
  bounded by the diff rather than by the repository's size.
- It groups **one phase per change**, ordered by directory structure, rather than by
  domain-area dependency order.

### Validation Rules

- The plan's frontmatter must carry a `phases` array. `require_phases` is not set, so
  `phases: []` is valid and the `foreach` simply has no items — the triage decision above
  is a legitimate outcome, not a failure.
- Unlike `init`, the `foreach` has no `when` filter: every phase the plan lists is
  documented, including a phase numbered 0.
- Verify steps write exactly `PASS` or `FAIL`; anything else is treated as `FAIL`.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Nothing changed since the baseline | One `[SKIP]` line; the baseline is left exactly as it was |
| Changes detected but none doc-worthy | The plan carries `phases: []`; no slice runs, but the baseline *is* regenerated so the same changes are not re-triaged next time |
| The corpus has no `BASELINE` | `detect-changes` has nothing to diff against — the corpus must be initialised first |
| The corpus stamp is missing or stale | The format-version gate fails before any agent call is made |

## Technical Implementation

### Data Model

| Model/Type | Key Fields | Purpose |
|--------|------------|---------|
| `DetectChangesResult` | `count`, `changes_path` | The two fields this flow branches on and hands to the planner; the classification counts alongside them are [change detection](../concepts/baseline-and-change-detection.md)'s |
| The update plan | frontmatter `phases`, body `## Decision` when empty | One phase per change group, or an explicit no-op with its rationale |

### Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `parse-plan` | `parsePlan()` | Shared with `init`; reads the frontmatter `phases` array |

## Integration Points

- **Depends on**: [change detection](../concepts/baseline-and-change-detection.md) for the
  change set and the refreshed baseline, [flow execution](./flow-execution.md) for
  dispatch, and [corpus gates](./corpus-gates.md) for the format and validation checks.
- **Used by**: [the CLI](./cli-entry-point.md) as `saaga run update`.
- **External systems**: the configured agent CLI, on the `high` model key throughout.

## Extension Guide

The triage rules and the diff budget live in `prompts/plan-update.md`, not in the flow
file — tightening what counts as doc-worthy is a prompt edit. Changing the step sequence
or the loop bound is a flow edit; see
[Extending Workflows](../patterns/extending-workflows.md).
