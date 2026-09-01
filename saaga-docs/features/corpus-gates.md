---
title: "Feature: Corpus Gates"
type: feature
last_verified: 2026-09-01
sources:
  - src/scripts/check-format-version.ts
  - src/scripts/check-plan-budget.ts
  - src/scripts/stamp-format-version.ts
  - src/scripts/ensure-gitignore.ts
  - src/scripts/validate-docs.ts
  - flows/init.flow.yaml
  - flows/update.flow.yaml
  - flows/quick-update.flow.yaml
  - flows/verify-quick-updates.flow.yaml
terms:
  - gate
---

# Feature: Corpus Gates

## Overview

The deterministic checks a documentation flow is bracketed by: one that refuses to start
against a corpus this build cannot write, one that holds a generated plan to a budget, and
one that fails a run whose output is structurally broken. Each is a
[built-in script](../concepts/script-registry.md), so a gate costs no agent tokens and gives
the same verdict twice.

## Key Concepts

Before working with this feature, understand these concepts:
- [Corpus Documents](../concepts/corpus-documents.md)
- [Corpus Budget](../concepts/corpus-budget.md)
- [Script Registry](../concepts/script-registry.md)

## Functional Specification

### Mechanism

1. **`check-format-version`** is the first step of every bundled flow. No corpus passes in
   both modes, and `init` goes on to create the tree. An existing corpus passes under
   `mode: update` only when its stamp matches the version this build writes, and always
   fails under `mode: init`, so re-initialising is an explicit delete-then-init rather than
   a silent overwrite. Both messages state the upgrade path.
2. **`ensure-gitignore`** follows in `init`, adding `.saaga-runs/` to the project's
   `.gitignore` and creating the file when there is none. A line that trims to the pattern
   counts as present, so it is idempotent.
3. **`check-plan-budget`** runs twice in `init`. Inside the planning loop it runs in
   `report` mode, where an over-budget plan is a verdict bound to scope for the loop's
   `until` to read and retry on; after the loop it runs again in `enforce` mode, where the
   same verdict throws — the `loop` primitive exits silently at its cap, so without the
   second call an over-budget plan would simply proceed. Both modes write the report
   **before** anything throws: a planner asked to try again has to read why.
4. **`stamp-format-version`** stamps the corpus once it exists. Only `init` runs it; the
   update-family flows already proved a matching stamp when their gate passed.
5. **`validate-docs`** is the last step of every flow, immediately after
   [navigation generation](./navigation-generation.md) so the generated pages are themselves
   checked, and deliberately after the baseline and the stamp: failing earlier would leave
   the corpus unbaselined, which makes the *next* run refuse to start.

| Flow | Gates, in order |
|------|-----------------|
| `init` | `check-format-version` (init), `ensure-gitignore`, `check-plan-budget` (report, in the plan loop), `check-plan-budget` (enforce), `stamp-format-version`, `validate-docs` |
| `update`, `quick-update`, `verify-quick-updates` | `check-format-version` (update), `validate-docs` |

### Validation Rules

- Fatal in `validate-docs`: broken links, invalid Mermaid diagrams, over-cap convention
  documents — the cap is fatal because it is the only thing holding the
  conventions/patterns split apart. Orphans only warn (unreachable is still correct); ten
  are printed and the rest left to the report.
- Fatal in `check-plan-budget` under `mode: enforce`: `OVER` and `UNPARSEABLE`. Unbudgeted
  documents, missing ownership and below-tier budgets are reported, never fatal.
- A missing or invalid `mode`, or a plan file that cannot be read, is a wiring fault and
  fails immediately in both modes.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Docs directory absent or empty | "No corpus": passes in both modes, and `validate-docs` returns an empty result rather than failing — every flow stays runnable against a greenfield project |
| Docs directory populated but unstamped | Version 0; the update-family flows refuse it as a pre-beta corpus |
| The repository has no measurable source | The budget passes with `no-measurable-source` and warns, so a language missing from the extension allowlist is visible rather than quietly ungoverned |
| The plan's decisions parse to nothing | `UNPARSEABLE`; the report says so and tells the author not to cut documents in response |
| An over-budget or unparseable plan in `enforce` mode | `NonResumableError`, because resuming replays the same plan; the message names delete-and-re-init as the fix |

## Technical Implementation

### Data Model

| Artifact | Key Fields | Purpose |
|--------|------------|---------|
| `<run_dir>/plan-budget-report.md` | Status, planned-vs-ceiling table, a "what to change" section, the per-document charge table | The budget verdict, and the retry's input |
| `<run_dir>/doc-validation.md` | Counts, then one section per problem class | The structural verdict, with a file and line per problem |

### Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `scripts/check-format-version` | `checkFormatVersion()` | The front gate; `mode` is `init` or `update` |
| `scripts/check-plan-budget` | `checkPlanBudgetScript()`, `CheckPlanBudgetResult` | The budget gate, and the verdict it binds to scope |
| `scripts/stamp-format-version` | `stampFormatVersion()` | Stamp a fresh corpus |
| `scripts/ensure-gitignore` | `ensureGitignore()` | Ensure one pattern is in `.gitignore` |
| `scripts/validate-docs` | `validateDocs()`, `ValidateDocsResult`, `REPORT_FILE` | The structural gate and its counts |

## Integration Points

- **Depends on**: the [document rules](../concepts/corpus-documents.md) and the
  [budget](../concepts/corpus-budget.md) these gates enforce, reached through the
  [script contract](../concepts/script-registry.md).
- **Used by**: [init](./init-workflow.md), [update](./update-workflow.md) and the
  [quick-update flows](./quick-update-workflows.md) — every bundled flow.
- **External systems**: none.

## Extension Guide

A new gate is a new [built-in script](../patterns/adding-built-in-scripts.md) plus a step in
the flows it belongs to. Place it after the corpus is on disk unless it checks a
precondition, so a failure does not leave a half-written corpus the next run refuses. Decide
once whether a finding is fatal: `ctx.warn` for what a reader should see, a throw for what
must not ship, `NonResumableError` when a retry would replay the same inputs.
