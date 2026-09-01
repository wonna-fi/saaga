---
title: "Feature: Init Workflow"
type: feature
sources:
  - flows/init.flow.yaml
  - src/scripts/parse-plan.ts
  - prompts/plan-init.md
  - prompts/document-architecture.md
  - prompts/verify-architecture.md
  - prompts/slice-doc.md
  - prompts/verify-domain-documentation.md
  - prompts/fix-documentation.md
terms:
  - plan file
  - phase
  - slice
  - verify/fix loop
last_verified: 2026-09-01
---

# Feature: Init Workflow

## Overview

`saaga run init` documents a repository that has no corpus yet: it writes an architecture
overview, plans the corpus as a numbered list of slices, then writes and verifies each
slice in turn, and finally baselines and validates what it produced.

## Key Concepts

Before working with this feature, understand these concepts:
- [Flow Definitions](../concepts/flow-definitions.md)
- [Corpus Budget](../concepts/corpus-budget.md)
- [Baseline and Change Detection](../concepts/baseline-and-change-detection.md)
- [Prompt Templates](../concepts/prompt-templates.md)

## Functional Specification

### Mechanism

The steps below are `flows/init.flow.yaml` in order; how any flow's steps are dispatched
is [flow execution](./flow-execution.md)'s subject, and the deterministic checks are
[corpus gates](./corpus-gates.md)'.

1. `check-format-version` in `mode: init`, then `ensure-gitignore` for `.saaga-runs/`.
2. **Architecture.** An agent step on `document-architecture` writes
   `<docs_dir>/ARCHITECTURE.md`, with `${run_dir}/app-structure.md` offered as scratch
   space.
3. **The plan loop** — `loop` with `max: 3`, `until: '${budget.status} == "PASS"'`:
   1. `plan-init` writes the plan to `${run_dir}/plans/${app}-init.plan.md` and is held to
      it by `expect_file`.
   2. `parse-plan` reads that file and binds its phase list to `phases`.
   3. `check-plan-budget` in `mode: report` binds its verdict to `budget`, which the
      loop's `until` reads on the next round.

   The report path `${run_dir}/plan-budget-report.md` is fixed rather than per-iteration.
   Inside round N the planner would have to be handed round N−1's report, and the
   [expression language](../concepts/scope-and-expressions.md) has no arithmetic to name
   it; overwriting one file hands the next attempt the previous verdict for free, and
   `plan-init` is written to read it if it exists.
4. **The budget gate.** `check-plan-budget` runs again in `mode: enforce`, outside the
   loop. This is what actually fails the run: `loop` exits silently at its cap, so a plan
   still over budget after three attempts would otherwise proceed.
5. **The architecture verify/fix loop** — `loop` with `max: 3`,
   `until: '${arch_status} == "PASS"'`: `verify-architecture` writes a review to
   `${run_dir}/architecture/review-${iteration}.md` and one word to
   `status-${iteration}.txt`; a `read-file` step binds that word to `arch_status`; an `if`
   on `${arch_status} != "PASS"` runs `fix-documentation` with `phase_number: architecture`
   against the same review.
6. **Phase 0** is documented outside the `foreach`, by a `slice-doc` agent step with
   `phase_number: 0` — and so without a verify/fix loop. `plan-init` reserves phase 0 for
   creating the category directories and their empty `INDEX.md` files, which must exist
   before anything writes into them and are not worth verifying.
7. `install-rules` writes the always-on agent rules — see
   [Install Rules](./install-rules.md).
8. **The slice loop** — `foreach` over `${phases}` with `when: '${phase.number} != 0'`.
   Per phase: a `slice-doc` agent step writes the slice's documents, then the same
   verify/fix loop shape as step 5 with `verify-domain-documentation` in place of
   `verify-architecture`, its own `status` variable, and artifacts under
   `${run_dir}/slice-${phase.number}/`.
9. **The tail**: `generate-baseline`, `stamp-format-version`, `generate-navigation` (see
   [Navigation Generation](./navigation-generation.md)), `validate-docs`.

Both verify steps are handed `${iteration}` and `${loop_max}` — the counters the `loop`
primitive binds — so the verifier knows when it is in the last round and that a `FAIL`
there is final. They are also handed a `deferred_minors_path`, which is how a round that
passes with minor findings still records them for a later run rather than holding `PASS`
back for them.

The three-step **verify/fix skeleton** — verify writes a status file, `read-file` binds
it, `if` runs the fixer — is shared by every agent-backed flow.
[Update](./update-workflow.md) and
[quick-update verification](./quick-update-workflows.md) reuse it unchanged.

### Validation Rules

- The plan file must open with YAML frontmatter containing a `phases` array; each entry
  needs a numeric `number` and a non-empty string `title`. Anything else is a
  `parse-plan` error naming the offending index.
- `init` does not set `require_phases`, so an empty `phases: []` parses and simply gives
  the `foreach` nothing to do.
- A verify step must write exactly `PASS` or `FAIL` to its status path; every other value
  is treated as not-`PASS` by the loop's `until` and by the `if`.
- Every agent step in this flow declares `model: high`; `init` never uses a cheaper key.
- `expect_file` is declared only where a file is the deliverable and its absence would be
  discovered late — on the `plan-init` step, whose output the next step parses.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| The plan is still over budget after three rounds | The loop exits at its cap and the `enforce` step fails the run non-resumably |
| `plan-init` does not write the plan file | The agent step fails on `expect_file`, before `parse-plan` is reached |
| The plan lists only phase 0 | The `foreach` has no surviving items; `install-rules` and the tail still run |
| Architecture verification never reaches `PASS` | The loop exits at its cap and the run continues — there is no enforce step for the architecture document |
| A slice's third verification round returns `FAIL` | `fix-documentation` still runs, but nothing verifies its work; the flow moves to the next phase |
| The corpus already carries a format stamp | `check-format-version` in `init` mode refuses the run; see [corpus gates](./corpus-gates.md) |

## Technical Implementation

### Data Model

| Model/Type | Key Fields | Purpose |
|--------|------------|---------|
| The plan file | frontmatter `phases`, body `## Phase N:` headings | The run's decisions: what to document, at what budget, from which sources |
| `Phase` | `number`, `title` | One parsed frontmatter entry; the `foreach` item, and the `slice-doc` label |
| `<run_dir>/architecture/`, `<run_dir>/slice-<n>/` | `review-<i>.md`, `status-<i>.txt`, `deferred-minors.md` | One verification round's report, its one-word verdict, and the minors it passed on |

### Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `parse-plan` | `parsePlan()` | Extracts the frontmatter `phases` array and coerces it to `Phase[]` |
| `parse-plan` | `Phase` | The `{ number, title }` shape a phase is bound to in scope |

### Prompts and their output contracts

What each prompt *instructs* is out of scope here; what it must leave on disk is not,
because the next step reads it.

| Prompt | Must produce |
|--------|--------------|
| `document-architecture` | `<docs_dir>/ARCHITECTURE.md` |
| `plan-init` | The plan file at `output_path` — frontmatter `phases`, plus a line budget and an owns/references line per document |
| `verify-architecture` | A review at `review_path` and exactly `PASS` or `FAIL` at `status_path` |
| `slice-doc` | Every document phase `phase_number` names, and the `INDEX.md` row for each |
| `verify-domain-documentation` | A review at `review_path` and exactly `PASS` or `FAIL` at `status_path` |
| `fix-documentation` | Corrections to the documents the review flagged, and nothing else |

## Integration Points

- **Depends on**: the [flow engine](./flow-execution.md) for dispatch, the
  [script registry](../concepts/script-registry.md) for every deterministic step, the
  [corpus gates](./corpus-gates.md) for the format, budget and validation checks, and
  [backend resolution](../concepts/backend-resolution.md) for what the `high` key names.
- **Used by**: [the CLI](./cli-entry-point.md) as `saaga run init`, which is also where
  `--rule-targets` enters this flow's scope.
- **External systems**: the configured agent CLI, invoked once per agent step.

## Extension Guide

Prompt content is where most changes belong: a step's behaviour is the prompt it names,
and editing `prompts/plan-init.md` or `prompts/slice-doc.md` changes what the flow
produces without touching the flow file. Changing the *shape* of the run — a loop bound,
a new step, a new artifact path — means editing `flows/init.flow.yaml`; see
[Extending Workflows](../patterns/extending-workflows.md) for the edits that go with it
and the end-to-end test that drives the result with the fake agent.
