# Feature: Update Workflow

## Overview

The `update` command incrementally updates existing documentation by detecting changes since the last BASELINE, creating a targeted update plan, documenting affected slices with verification, and regenerating the baseline. It only runs when actual changes are detected.

## Key Concepts

Before working with this feature, understand these concepts:
- [Flow Definitions](../concepts/flow-definitions.md)
- [Prompt Templates](../concepts/prompt-templates.md)
- [Baseline and Change Detection](../concepts/baseline-and-change-detection.md)
- [Script Registry](../concepts/script-registry.md)
- [Scope and Expressions](../concepts/scope-and-expressions.md)

## Functional Specification

### User Flow

1. User runs `saaga update [dir]` (dir defaults to the current working directory)
2. CLI resolves the agent backend and creates a run context
3. Script `detect-changes` compares the work tree against `<docs_dir>/BASELINE`
4. If no changes detected (`${changes.count} == 0`): workflow ends immediately (no-op)
5. If changes exist:
   - Agent creates an update plan at `<run_dir>/plans/<app>-update-<date>.plan.md`
   - Engine asserts the plan file was created (`expect_file`)
   - Script `parse-plan` extracts phases from the plan
   - For each phase: agent documents the slice, then enters verify/fix loop (up to 3 iterations)
   - Script `generate-baseline` regenerates `<docs_dir>/BASELINE`

### Validation Rules

- `dir` must exist and be a directory (defaults to current working directory if omitted)
- A `<docs_dir>/BASELINE` file must exist (otherwise `detect-changes` throws; run `init` first)
- A backend must be resolvable via `--backend` flag or `.saaga/config.yaml`

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Directory does not exist | Throws `Error: Directory not found: <dir>` |
| Path is not a directory | Throws `Error: Not a directory: <dir>` |
| No `<docs_dir>/BASELINE` file exists | `detect-changes` throws `Error: BASELINE file not found... Run 'init' first` |
| No changes since BASELINE | `${changes.count}` is 0, `if` condition is false, workflow ends without agent invocations |
| Agent step exits non-zero | Throws `AgentStepFailedError`, CLI returns the exit code |
| Plan file not produced | Throws `ExpectFileMissingError` |
| Verify/fix loop exhausts iterations | Execution continues to next phase (no error) |

## Technical Implementation

### Flow File

`flows/update.flow.yaml` — defines the conditional step sequence.

### Step Sequence

| # | Type | Details |
|---|------|---------|
| 1 | `script` | Name: `detect-changes`, args: `app_dir`, `output_dir`, `docs_dir`, sets `${changes}` in scope |
| 2 | `if` | Condition: `${changes.count} != 0` — gates all subsequent steps |
| 2.1 | `agent` | Prompt: `plan-update`, vars: `{app}`, `{docs_dir}`, `{changes_path}`, `{output_path}` (uses `${date}` in plan filename), `expect_file` asserts plan was written |
| 2.2 | `script` | Name: `parse-plan`, reads update plan, sets `${phases}` |
| 2.3 | `foreach` | Over `${phases}`: for each phase runs `slice-doc` agent, then verify/fix loop (max 3 iterations of `verify-domain-documentation` → `read-file` status → conditional `fix-documentation`) |
| 2.4 | `script` | Name: `generate-baseline`, args: `app_dir`, `docs_dir`, regenerates `<docs_dir>/BASELINE` |

### Initial Scope

| Variable | Value |
|----------|-------|
| `${app}` | Application directory basename |
| `${app_path}` | Absolute path to the application directory |
| `${docs_dir}` | Documentation directory name (from `config.docsDir` or default `"saaga-docs"`) |
| `${run_id}` | Unique run identifier (format: `<app>-update-<YYYYMMDD>-<HHMMSS>-<hex>`) |
| `${run_dir}` | Absolute path to the run artifacts directory |
| `${date}` | Date portion of the run timestamp (YYYYMMDD format) |

### Scope After detect-changes

The `detect-changes` script sets `${changes}` with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `${changes.count}` | number | Total number of detected changes |
| `${changes.changes_path}` | string | Absolute path to the markdown changes report |
| `${changes.changed}` | number | Count of files with modified content |
| `${changes.new}` | number | Count of new-to-scope files |
| `${changes.truly_deleted}` | number | Count of removed files |
| `${changes.newly_ignored}` | number | Count of files now excluded from scope |

### Services/Functions

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/cli.ts` | `runCli()` | CLI entry point, parses `update` subcommand |
| `src/engine/runner.ts` | `runFlow()` | Executes the loaded flow definition |
| `src/engine/loader.ts` | `loadFlow()` | Loads `flows/update.flow.yaml` |
| `src/scripts/detect-changes.ts` | `detectChanges()` | Compares work tree vs. BASELINE, writes changes report |
| `src/scripts/parse-plan.ts` | `parsePlan()` | Extracts phases from the plan's YAML frontmatter |
| `src/scripts/generate-baseline.ts` | `generateBaseline()` | Regenerates `<docs_dir>/BASELINE` after updates |
| `src/run-context.ts` | `createRunContext()` | Creates run ID and run directory |
| `src/templates.ts` | `renderPromptFile()` | Renders prompt templates with variables |

### Prompt Templates Used

| Template | Purpose |
|----------|---------|
| `prompts/plan-update.md` | Create an incremental update plan based on detected changes |
| `prompts/slice-doc.md` | Document a single phase from the update plan |
| `prompts/verify-domain-documentation.md` | Verify documentation quality |
| `prompts/fix-documentation.md` | Fix verification errors |

## Integration Points

- **Depends on**: Agent backend, prompt templates, built-in scripts (`detect-changes`, `parse-plan`, `generate-baseline`), existing `<docs_dir>/BASELINE`
- **Used by**: Users maintaining documentation after code changes
- **External systems**: External agent CLIs (cursor-agent, copilot, claude)

## Extension Guide

To modify the update workflow:

1. **Change the early-exit condition**: Modify the `if: '${changes.count} != 0'` predicate — for example, only proceed when there are more than N changes
2. **Add pre-processing**: Insert steps before the `if` block to transform or filter the changes report
3. **Skip baseline regeneration**: Remove the final `generate-baseline` script step (not recommended for production use)
4. **Add ARCHITECTURE.md refresh**: Insert an agent step with `document-architecture` prompt inside the `if` block when structural changes are detected
5. **Adjust verify/fix iterations**: Change the `max:` value in the nested `loop` step
