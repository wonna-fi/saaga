# Feature: Quick-Update Workflow

## Overview

The quick-update workflow performs a fast, single-session documentation update using a cheaper/faster AI model. It detects changes since the last BASELINE, asks an agent to triage and apply targeted documentation edits, archives the changes report, and regenerates the BASELINE. The output is a metadata artifact (`summary.md` + archived `changes.md`) that can be verified and hardened later by the `verify-quick-updates` command.

## Key Concepts

Before working with this feature, understand these concepts:

- [Backend Resolution](../concepts/backend-resolution.md) — how the medium model key is selected (`--model medium=<model>` / `backends.<backend>.models.medium` / built-in default)
- [Baseline and Change Detection](../concepts/baseline-and-change-detection.md) — how `detect-changes` produces the changes report
- [Flow Definitions](../concepts/flow-definitions.md) — the `quick-update.flow.yaml` step sequence
- [Script Registry](../concepts/script-registry.md) — the `archive-quick-update`, `cleanup-quick-update-dir`, and `generate-baseline` scripts used in this flow
- [Prompt Templates](../concepts/prompt-templates.md) — the `quick-update` prompt template

## Functional Specification

### User Flow

1. User runs `saaga run quick-update [dir] [flags]` (dir defaults to the current working directory)
2. CLI validates `dir`, resolves the agent using the quick model (see [Backend Resolution](../concepts/backend-resolution.md)), creates a run context, and executes `flows/quick-update.flow.yaml`
3. Flow runs `detect-changes` — compares work tree against BASELINE; if no changes are found, the flow exits early (no documentation update, no metadata artifact)
4. Flow pre-creates the quick-update metadata directory at `<docs_dir>/metadata/quick_updates/<run_id>/` (this happens automatically before agent invocation via `runAgentStep`)
5. Agent receives the `quick-update` prompt with `{changes_path}`, `{status_path}`, and `{summary_path}` variables
6. Agent triages changes, updates affected documentation files, and writes:
   - `{status_path}` — exactly `UPDATED` or `SKIPPED`
   - `{summary_path}` — structured YAML frontmatter + prose summary (only when `UPDATED`)
7. Flow reads the status file:
   - If `UPDATED`, runs `archive-quick-update` with `summary_path` — the script first verifies the summary file exists at that path (throwing if it doesn't), then copies the changes report into the quick-update metadata folder
   - If not `UPDATED`, runs `cleanup-quick-update-dir` to remove the pre-created metadata folder
8. Flow runs `generate-baseline` to regenerate the content manifest

### Metadata Artifact Layout

When status is `UPDATED`, two files are written under the app's `<docs_dir>/metadata/quick_updates/<run_id>/` folder:

| File | Written by | Contents |
|------|-----------|----------|
| `summary.md` | Agent (via `quick-update` prompt) | YAML frontmatter (`generated`, `verified: false`, `docs_touched`, `confidence`) + prose summary |
| `changes.md` | `archive-quick-update` script | Copy of the detect-changes report from the run directory |

### Validation Rules

- `dir` must exist on disk and be a directory (defaults to current working directory if omitted)
- If `detect-changes` reports zero changes, the flow exits without running the agent
- The quick-update metadata directory (`<docs_dir>/metadata/quick_updates/<run_id>/`) is pre-created before agent invocation
- The agent must write exactly `UPDATED` or `SKIPPED` to the status file; the flow branches on this value
- `archive-quick-update` only runs when status is `UPDATED`; it verifies the `summary_path` file exists before copying the changes report — if the summary is absent, it throws and prevents the baseline from advancing with an incomplete artifact
- `cleanup-quick-update-dir` only runs when status is not `UPDATED`; it removes the pre-created metadata folder to avoid leaving empty directories

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| No changes since BASELINE | `detect-changes` returns count 0; flow exits early; no agent call, no metadata directory created |
| Agent writes `SKIPPED` | Metadata folder is pre-created, then removed by `cleanup-quick-update-dir`; baseline is still regenerated |
| Agent writes `UPDATED` but `summary.md` is missing | `archive-quick-update` throws; flow fails before baseline is regenerated |
| `config.backends.<backend>.models.medium` set in `.saaga/config.yaml` | That model is used instead of the built-in medium-key default |
| `--model medium=<model>` flag provided | Overrides the medium model key for quick-update |

## Technical Implementation

### Flow Execution

The flow is defined in `flows/quick-update.flow.yaml` and executed by `runFlow()` with initial scope `{ app, app_path, docs_dir, run_id, run_dir, date }`.

Step sequence:

1. `script` — `detect-changes`: args `{ app_dir: ${app_path}, output_dir: ${run_dir}, docs_dir: ${docs_dir} }`; stores result as `changes` (includes `changes.count` and `changes.changes_path`)
2. `if ${changes.count} != 0`:
   - `agent` — `quick-update` prompt: vars `{ app, docs_dir, changes_path, status_path, summary_path }`; `status_path` = `${run_dir}/quick-update-status.txt`; `summary_path` = `${app_path}/${docs_dir}/metadata/quick_updates/${run_id}/summary.md` (the metadata directory is automatically pre-created by `runAgentStep` before agent invocation)
   - `read-file` — reads status file into `status` scope variable
   - `if ${status} == "UPDATED"`: `script` — `archive-quick-update`: args `{ changes_path: ${changes.changes_path}, dest_dir: ${app_path}/${docs_dir}/metadata/quick_updates/${run_id}, summary_path: ${app_path}/${docs_dir}/metadata/quick_updates/${run_id}/summary.md }`
   - `if ${status} != "UPDATED"`: `script` — `cleanup-quick-update-dir`: args `{ metadata_root: ${app_path}/${docs_dir}/metadata/quick_updates, run_id: ${run_id} }`
   - `script` — `generate-baseline`: args `{ app_dir: ${app_path}, docs_dir: ${docs_dir} }`

### Services/Functions

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/scripts/detect-changes.ts` | `detectChanges()` | Compares work tree against BASELINE; returns counts and path to changes report |
| `src/scripts/archive-quick-update.ts` | `archiveQuickUpdate()` | Copies the changes report into the quick-update metadata folder |
| `src/scripts/cleanup-quick-update-dir.ts` | `cleanupQuickUpdateDir()` | Removes the pre-created quick-update metadata folder when status is not UPDATED; validates path safety |
| `src/scripts/generate-baseline.ts` | `generateBaseline()` | Regenerates `<docs_dir>/BASELINE` after the update |
| `src/engine/runner.ts` | `runFlow()` | Executes the flow; agent steps internally pre-create directories for output paths under write-permitted roots (`run_dir` or `permissions.writeRoots`) |
| `src/cli/backend.ts` | `resolveModel()` | Returns the medium-key model for quick-update (`resolveModel(backend, "medium", ...)`) |
| `src/cli.ts` | `runCli()` | Entry point; `saaga run quick-update` runs with `useQuickModel: true` |

## Integration Points

- **Depends on**: `detect-changes` script, `archive-quick-update` script, `cleanup-quick-update-dir` script, `generate-baseline` script, `quick-update` prompt template, BASELINE file
- **Feeds into**: `verify-quick-updates` workflow (reads the `summary.md` and `changes.md` artifacts)
- **External systems**: AI agent backend (Cursor, Copilot, or Claude) invoked with the quick model

## Extension Guide

- **Adjust the quick model**: set `backends.<backend>.models.medium` in `.saaga/config.yaml` or pass `--model medium=<model>`
- **Change the agent instructions**: edit `prompts/quick-update.md`
- **Add post-update steps**: add steps to `flows/quick-update.flow.yaml` after `generate-baseline`
- **Customize metadata layout**: the `summary_path` variable in the flow YAML controls where the summary is written
