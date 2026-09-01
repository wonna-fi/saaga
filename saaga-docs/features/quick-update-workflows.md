---
title: "Feature: Quick-Update Workflows"
type: feature
sources:
  - flows/quick-update.flow.yaml
  - flows/verify-quick-updates.flow.yaml
  - prompts/quick-update.md
  - prompts/plan-verify-quick-updates.md
  - src/scripts/archive-quick-update.ts
  - src/scripts/collect-quick-updates.ts
  - src/scripts/remove-quick-updates.ts
  - src/scripts/cleanup-quick-update-dir.ts
  - src/scripts/parse-plan.ts
  - .github/workflows/quick-update-nightly.yml
  - .github/workflows/verify-quick-updates-weekly.yml
terms:
  - quick-update artifact
---

# Feature: Quick-Update Workflows

## Overview

`quick-update` records a small change into the corpus in one cheap agent session and leaves
an artifact saying what it touched; `verify-quick-updates` later reads every accumulated
artifact and re-documents those slices at full quality. They are one subject because they
are one artifact: the first writes it, the second consumes and deletes it. The split lets
the corpus track the repository daily while the expensive pass runs on its own schedule.

## Key Concepts

Before working with this feature, understand these concepts:
- [Baseline and Change Detection](../concepts/baseline-and-change-detection.md)
- [Script Registry](../concepts/script-registry.md)

## Functional Specification

### Mechanism

**`flows/quick-update.flow.yaml`:** `check-format-version` (`mode: update`) and
`detect-changes`; then, inside an `if` on `'${changes.count} != 0'`
(`skip_label: no changes detected`):

1. The `quick-update` agent step. It is the only agent step in any bundled flow that omits
   `model:`, so it runs on the [default model key](../concepts/backend-resolution.md)
   rather than `high`; it gets the changes report, a status path in the run directory, and
   a `summary.md` path inside this run id's artifact folder.
2. `read-file` binds the status word to `status`; two `if` steps branch on it — `UPDATED`
   runs `archive-quick-update`, anything else `cleanup-quick-update-dir` — and then
   `generate-baseline`, `generate-navigation` and `validate-docs` close the flow.

**`flows/verify-quick-updates.flow.yaml`:** `check-format-version` (`mode: update`) and
`collect-quick-updates`, which snapshots the artifact folders into `quick_updates`; then,
inside an `if` on `'${quick_updates.count} != 0'`:

1. `plan-verify-quick-updates` writes a plan from the manifest and the artifacts it names
   (held by `expect_file`); `parse-plan` reads it with `require_phases: true`.
2. A `foreach` runs `slice-doc` and the verify/fix loop exactly as
   [Init Workflow](./init-workflow.md) describes, except that `changes_dir` points at the
   metadata directory instead of `none`, so the verifier reads the original change reports
   rather than trusting the summaries.
3. `remove-quick-updates`, `generate-navigation`, `validate-docs` — and no
   `generate-baseline`: the quick update already advanced it, and verification corrects
   documentation without changing what has been documented.

### The artifact lifecycle

A folder at `<app>/<docs_dir>/metadata/quick_updates/<run_id>/` holding:

| File | Written by | Contents |
|------|-----------|----------|
| `summary.md` | the `quick-update` agent | Frontmatter `generated`, `verified: false`, `docs_touched`, `confidence` (`high`/`medium`/`low`), then prose on what changed, what was updated, and which claims were uncertain |
| `changes.md` | `archive-quick-update` | A copy of the `detect-changes` report from the run that produced it |

The report is copied rather than re-derived because the quick update advances the baseline
in the same run: by then `detect-changes` cannot reproduce that change set. The folder
exists before the agent runs — `summary_path` is under a granted write root, so
[flow execution](./flow-execution.md)'s directory preflight creates its parent — which is
why a non-`UPDATED` outcome needs `cleanup-quick-update-dir`.

### Validation Rules

- The status file must contain exactly `UPDATED` or `SKIPPED`; only `UPDATED` archives,
  and every other value, including none, cleans up.
- `archive-quick-update` refuses when `summary_path` is given but no summary exists, and
  `collect-quick-updates` counts a folder only if it contains one: an artifact without a
  summary is something `verify-quick-updates` cannot consume. Both deletion handlers
  refuse an id resolving outside their base directory.
- `require_phases: true` makes an empty plan an error here, because the next step deletes
  the collected metadata — silently verifying nothing would destroy it.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| The agent finds nothing doc-worthy | It writes `SKIPPED`, the pre-created folder is removed, and the baseline is still advanced |
| A quick update is interrupted before its summary is written | The folder survives but the next `collect-quick-updates` ignores it |
| A new quick update lands while verification runs | It is not in the manifest snapshot, so `remove-quick-updates` leaves it for next time |

## Technical Implementation

### Data Model

| Model/Type | Key Fields | Purpose |
|--------|------------|---------|
| `quick-updates-manifest.json` / `CollectQuickUpdatesResult` | `metadata_dir`, `ids`, `captured_at`; `count`, `manifest_path` | The snapshot written into the run directory: the exact folder set this verification owns and branches on |

### Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `archive-quick-update` | `archiveQuickUpdate()` | Copies the changes report into the artifact folder, after asserting the summary exists |
| `collect-quick-updates` | `collectQuickUpdates()` | Snapshots artifact folders carrying a summary and writes the manifest |
| `remove-quick-updates` | `removeQuickUpdates()` | Deletes exactly the folders the manifest lists |
| `cleanup-quick-update-dir` | `cleanupQuickUpdateDir()` | Removes one pre-created folder after a non-`UPDATED` outcome |

## Integration Points

- **Depends on**: [change detection](../concepts/baseline-and-change-detection.md), the
  [script registry](../concepts/script-registry.md) for the four artifact handlers, and
  [corpus gates](./corpus-gates.md) for the format and validation checks.
- **Used by**: [the CLI](./cli-entry-point.md), as `saaga run quick-update` and
  `saaga run verify-quick-updates`.
- **External systems**: this repository's own `.github/` workflows run `quick-update`
  nightly and, on Mondays, `quick-update` followed by `verify-quick-updates`.

## Extension Guide

The split point is the status word: a new outcome the `quick-update` prompt can report needs
a matching `if` branch, because an unhandled value falls through to cleanup. Changing what
the artifact contains means editing `prompts/quick-update.md` and
`prompts/plan-verify-quick-updates.md` together — writer and reader of one file. See
[Extending Workflows](../patterns/extending-workflows.md).
