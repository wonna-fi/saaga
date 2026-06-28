# Feature: Slice Workflow

## Overview

The `slice` command documents a single phase from an existing documentation plan and runs the verify/fix quality loop. It is used to execute individual phases independently — either as a standalone operation or when resuming interrupted documentation work.

## Key Concepts

Before working with this feature, understand these concepts:
- [Flow Definitions](../concepts/flow-definitions.md)
- [Prompt Templates](../concepts/prompt-templates.md)
- [Run Context and Isolation](../concepts/run-context.md)
- [Scope and Expressions](../concepts/scope-and-expressions.md)

## Functional Specification

### User Flow

1. User runs `saaga slice <plan> <phase>`
2. CLI validates the phase number is a positive integer
3. CLI resolves the plan path to an absolute path and verifies it exists as a file
4. CLI derives the run directory from the plan path (if it lives under `$SAAGA_DIR/runs/<id>/plans/`)
5. If derivation fails, a fresh run context is created as a fallback
6. Agent documents the slice using the `slice-doc` prompt
7. Verify/fix loop (up to 3 iterations):
   - Agent verifies documentation quality
   - Engine reads the status file (PASS/FAIL)
   - If FAIL: agent fixes errors using the review report
8. Execution completes (no baseline regeneration — that's the caller's responsibility)

### Run Directory Derivation

The `slice` command has special logic to reuse an existing run directory when the plan path follows the standard layout:

```
$SAAGA_DIR/runs/<run-id>/plans/<plan-file>.plan.md
                     ↑
                     Extracted as runDir: $SAAGA_DIR/runs/<run-id>
```

This allows the slice command to write its review/status artifacts alongside the plan that was created by a prior `init` or `update` run. If the plan is not inside this layout, a fresh run context is created.

### Validation Rules

- `<phase>` must match `/^\d+$/` (non-negative integer string)
- `<plan>` must be an existing file (not a directory)
- A backend must be resolvable via `--backend` flag or `.saaga/config.yaml`

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Phase is not a valid integer | Throws `Error: Phase number must be a positive integer, got: <phase>` |
| Plan file does not exist | Throws `Error: Plan file not found: <plan>` |
| Plan path is not a file | Throws `Error: Plan path is not a file: <plan>` |
| Plan is outside standard layout | Fresh run context is created (fallback) |
| Agent step exits non-zero | Throws `AgentStepFailedError`, CLI returns the exit code |
| Verify/fix loop exhausts iterations | Execution continues normally (no error) |
| `SAAGA_DIR` and `HOME` both unset (derivation) | Derivation returns null, falls back to creating a fresh run context |

## Technical Implementation

### Flow File

`flows/slice.flow.yaml` — minimal workflow: one agent step + verify/fix loop.

### Step Sequence

| # | Type | Details |
|---|------|---------|
| 1 | `agent` | Prompt: `slice-doc`, vars: `{plan}`, `{phase_number}` |
| 2 | `loop` | Max: 3, until: `${status} == "PASS"` |
| 2.1 | `agent` | Prompt: `verify-domain-documentation`, vars: `{plan}`, `{phase_number}`, `{review_path}`, `{status_path}`, `{changes_dir}` (set to `none` — coverage verification is skipped) |
| 2.2 | `read-file` | Path: status file, set: `status`, trim: true |
| 2.3 | `if` | Condition: `${status} != "PASS"`, then: fix agent |

### Initial Scope

| Variable | Value |
|----------|-------|
| `${plan}` | Absolute path to the plan file |
| `${phase_number}` | Phase number (as a number, parsed from the CLI argument) |
| `${run_id}` | Run identifier (derived or freshly generated) |
| `${run_dir}` | Run directory (derived from plan path or freshly created) |

### Services/Functions

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/cli.ts` | `runCli()` | CLI entry point, parses `slice` subcommand |
| `src/engine/runner.ts` | `runFlow()` | Executes the loaded flow definition |
| `src/engine/loader.ts` | `loadFlow()` | Loads `flows/slice.flow.yaml` |
| `src/run-context.ts` | `createRunContext()` | Creates a fresh run context (fallback path) |
| `src/templates.ts` | `renderPromptFile()` | Renders prompt templates with variables |

### Internal Implementation

> Functions below are internal to `src/cli.ts` and not exported. They handle the slice-specific CLI logic.
>
> - `runSliceSubcommand()` — orchestrates plan validation, run dir derivation, and flow execution
> - `deriveRunDirFromPlanPath()` — extracts run ID and dir from the standard plan path layout
> - `resolveSaagaDir()` — determines the Saaga base directory from env vars

### Prompt Templates Used

| Template | Purpose |
|----------|---------|
| `prompts/slice-doc.md` | Document a single phase from the plan |
| `prompts/verify-domain-documentation.md` | Verify documentation quality |
| `prompts/fix-documentation.md` | Fix verification errors |

## Integration Points

- **Depends on**: Agent backend, prompt templates, an existing plan file (produced by `init` or `update`)
- **Used by**: Users documenting a single phase independently, or the `init`/`update` workflows internally (via `foreach` with embedded slice-doc + verify/fix)
- **External systems**: External agent CLIs (`cursor-agent`, `copilot`, `claude`)

## Extension Guide

To modify the slice workflow:

1. **Adjust verify/fix iterations**: Change `max: 3` in the loop step to your desired cap
2. **Add pre-documentation analysis**: Insert a script step before the `slice-doc` agent to prepare context
3. **Add post-verification reporting**: Add steps after the loop to summarize results
4. **Change verification criteria**: Modify the `prompts/verify-domain-documentation.md` template to check different quality aspects
5. **Add post-slice cleanup**: Add a script step after the loop to archive or summarize results
