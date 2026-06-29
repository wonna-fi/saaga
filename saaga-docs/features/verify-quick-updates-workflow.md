# Feature: Verify Quick Updates Workflow

## Overview

The verify-quick-updates workflow hardens all accumulated quick-update metadata artifacts. It collects the set of unverified quick-update folders, asks an agent to consolidate them into a verification plan, executes a full slice-doc + verify/fix loop for each plan phase, and then removes exactly the artifacts that were processed. The result is documentation brought up to the same quality standard as the `update` command.

## Key Concepts

Before working with this feature, understand these concepts:

- [Flow Definitions](../concepts/flow-definitions.md) — the `verify-quick-updates.flow.yaml` step sequence
- [Script Registry](../concepts/script-registry.md) — the `collect-quick-updates` and `remove-quick-updates` scripts
- [Prompt Templates](../concepts/prompt-templates.md) — the `plan-verify-quick-updates`, `slice-doc`, `verify-domain-documentation`, and `fix-documentation` prompt templates
- [Quick-Update Workflow](./quick-update-workflow.md) — produces the metadata artifacts consumed by this workflow

## Functional Specification

### User Flow

1. User runs `saaga verify-quick-updates [dir] [flags]` (dir defaults to the current working directory)
2. CLI validates `dir`, resolves the agent using the standard model, creates a run context, and executes `flows/verify-quick-updates.flow.yaml`
3. Flow runs `collect-quick-updates` — snapshots all subdirectories under `<docs_dir>/metadata/quick_updates/`; if none are found, flow exits early
4. Agent receives the `plan-verify-quick-updates` prompt; reads each artifact's `changes.md` and `summary.md`, consolidates them into a phased verification plan, and writes the plan file
5. Flow parses the plan's YAML frontmatter to extract phases
6. For each phase, the flow:
   - Runs the `slice-doc` agent to re-document the affected slice
   - Enters a verify/fix loop (max 3 iterations): verify → read status → conditionally fix
7. Flow runs `remove-quick-updates` — deletes exactly the metadata folders captured in the manifest (folders created after the snapshot are preserved)

### Metadata Artifact Lifecycle

| Stage | Action |
|-------|--------|
| Before run | `<docs_dir>/metadata/quick_updates/<id>/` folders exist for each unverified quick-update |
| `collect-quick-updates` | Writes `quick-updates-manifest.json` in the run directory listing all current folder IDs |
| After all phases | `remove-quick-updates` deletes the folders listed in the manifest |
| Folders created during run | Preserved (not in manifest) |

### Validation Rules

- `dir` must exist on disk and be a directory (defaults to current working directory if omitted)
- If `collect-quick-updates` returns count 0 (no metadata folders), the flow exits without running the agent
- The plan agent must write a valid plan file at `{output_path}`; `expect_file` assertion enforces this
- `remove-quick-updates` only deletes folders whose IDs were present at manifest creation time

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| No unverified quick-update artifacts | `collect-quick-updates` returns count 0; flow exits early |
| New quick-update artifact created during run | Not in the manifest; preserved after `remove-quick-updates` |
| Plan agent fails to write plan file | `expect_file` assertion causes the step to fail |
| Verify loop reaches max 3 iterations without PASS | Loop exits; documentation is left in its current state |

## Technical Implementation

### Flow Execution

The flow is defined in `flows/verify-quick-updates.flow.yaml` and executed by `runFlow()` with initial scope `{ app, app_path, docs_dir, run_id, run_dir, date }`.

Step sequence:

1. `script` — `collect-quick-updates`: args `{ metadata_dir: ${app_path}/${docs_dir}/metadata/quick_updates, output_dir: ${run_dir} }`; stores result as `quick_updates` (includes `quick_updates.count` and `quick_updates.manifest_path`)
2. `if ${quick_updates.count} != 0`:
   - `agent` — `plan-verify-quick-updates` prompt: vars `{ app, docs_dir, manifest_path, metadata_dir, output_path }`; `metadata_dir` = `${app_path}/${docs_dir}/metadata/quick_updates`; `expect_file` asserts the plan file is written
   - `script` — `parse-plan`: args `{ file: ${run_dir}/plans/..., require_phases: "true" }`; stores result as `phases`; the `require_phases` flag causes an error if the plan has no phases — this guards against silently skipping verification and then deleting metadata
   - `foreach` over `phases`:
     - `agent` — `slice-doc` prompt
     - `loop` (max 3, until `${status} == "PASS"`):
       - `agent` — `verify-domain-documentation` prompt, vars include `changes_dir: ${app_path}/${docs_dir}/metadata/quick_updates` and `docs_dir: ${docs_dir}` (enables coverage verification against the raw change reports — unlike `init`/`update` which pass `none`)
       - `read-file` — reads status file into `status`
       - `if ${status} != "PASS"`: `agent` — `fix-documentation` prompt
   - `script` — `remove-quick-updates`: args `{ manifest: ${quick_updates.manifest_path} }`

### Services/Functions

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/scripts/collect-quick-updates.ts` | `collectQuickUpdates()` | Snapshots unverified metadata folders; writes manifest JSON |
| `src/scripts/remove-quick-updates.ts` | `removeQuickUpdates()` | Deletes folders listed in the manifest |
| `src/scripts/parse-plan.ts` | `parsePlan()` | Extracts phases from the verification plan's YAML frontmatter |
| `src/cli.ts` | `runCli()` | Entry point; dispatches `verify-quick-updates` subcommand |

## Integration Points

- **Depends on**: `collect-quick-updates` script, `remove-quick-updates` script, `parse-plan` script, `plan-verify-quick-updates` / `slice-doc` / `verify-domain-documentation` / `fix-documentation` prompt templates
- **Consumes**: quick-update metadata artifacts produced by the `quick-update` workflow
- **External systems**: AI agent backend (cursor, copilot, or claude) invoked with the standard model

## Extension Guide

- **Adjust the verify/fix loop cap**: change `max: 3` in `flows/verify-quick-updates.flow.yaml`
- **Change consolidation instructions**: edit `prompts/plan-verify-quick-updates.md`
- **Add post-verification steps**: add steps after `remove-quick-updates` in the flow YAML
- **Preserve processed artifacts**: remove the `remove-quick-updates` script step from the flow
