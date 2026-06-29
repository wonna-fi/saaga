# Feature: Init Workflow

## Overview

The `init` command generates complete domain documentation for an application from scratch. It creates architecture docs, a documentation plan, sets up the folder structure, writes docs for every domain area, verifies quality, and creates a content baseline for future change detection.

## Key Concepts

Before working with this feature, understand these concepts:
- [Flow Definitions](../concepts/flow-definitions.md)
- [Prompt Templates](../concepts/prompt-templates.md)
- [Agent Interface](../concepts/agent-interface.md)
- [Scope and Expressions](../concepts/scope-and-expressions.md)
- [Script Registry](../concepts/script-registry.md)
- [Baseline and Change Detection](../concepts/baseline-and-change-detection.md)

## Functional Specification

### User Flow

1. User runs `saaga init [dir]` (dir defaults to the current working directory)
2. CLI resolves the agent backend and creates a run context with a unique run ID
3. Agent generates `<docs_dir>/ARCHITECTURE.md` for the application
4. Agent creates a documentation plan at `<run_dir>/plans/<app>-init.plan.md`
5. Engine asserts the plan file was created (`expect_file`)
6. Script `parse-plan` extracts phases from the plan's YAML frontmatter
7. Agent documents phase 0 (folder structure setup via `slice-doc`)
8. Script `install-rules` installs documentation rule stubs into the application directory for the requested rule targets
9. For each subsequent phase (where `phase.number != 0`):
   - Agent documents the slice using `slice-doc`
   - Verify/fix loop (up to 3 iterations): verify → read status → conditionally fix
10. Script `generate-baseline` writes `<docs_dir>/BASELINE` content manifest

### Validation Rules

- `dir` must exist and be a directory (defaults to current working directory if omitted; throws `Error: Directory not found: <dir>` or `Error: Not a directory: <dir>`)
- A backend must be resolvable via `--backend` flag or `.saaga/config.yaml`
- The backend must be able to authenticate (each backend handles its own credentials)
- The plan file must be produced by the planning agent (enforced by `expect_file`)

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Directory does not exist | Throws `Error: Directory not found: <dir>` |
| Path is not a directory | Throws `Error: Not a directory: <dir>` |
| Agent step exits non-zero | Throws `AgentStepFailedError`, CLI returns the exit code |
| Plan file not produced | Throws `ExpectFileMissingError` |
| Plan has no YAML frontmatter | `parse-plan` throws `Error: no YAML frontmatter found` |
| Plan has no `phases` array | `parse-plan` throws `Error: missing or invalid 'phases' array` |
| Verify/fix loop exhausts 3 iterations without PASS | Execution continues to next phase (no error) |
| `HOME` is unset and `SAAGA_DIR` not provided | Throws `Error: Cannot determine run directory: HOME is not set and SAAGA_DIR is not provided` |

## Technical Implementation

### Flow File

`flows/init.flow.yaml` — defines the complete step sequence.

### Step Sequence

| # | Type | Details |
|---|------|---------|
| 1 | `agent` | Prompt: `document-architecture`, vars: `{app}`, `{docs_dir}` |
| 2 | `agent` | Prompt: `plan-init`, vars: `{app}`, `{docs_dir}`, `{output_path}`, expect_file: plan path |
| 3 | `script` | Name: `parse-plan`, reads plan file, sets `${phases}` in scope |
| 4 | `agent` | Prompt: `slice-doc`, vars: `{plan}`, `{phase_number}=0` |
| 5 | `script` | Name: `install-rules`, args: `{app_dir}`, `{app}`, `{rule_targets}`, `{docs_dir}` |
| 6 | `foreach` | Over `${phases}`, when `${phase.number} != 0`: slice-doc + verify/fix loop (max 3) |
| 7 | `script` | Name: `generate-baseline`, args: `{app_dir}`, `{docs_dir}`, writes `<docs_dir>/BASELINE` |

### Initial Scope

The CLI provides these scope variables to the flow:

| Variable | Value |
|----------|-------|
| `${app}` | Application directory basename |
| `${app_path}` | Absolute path to the application directory |
| `${docs_dir}` | Documentation directory name (from `config.docsDir` or default `"saaga-docs"`) |
| `${run_id}` | Unique run identifier (format: `<app>-init-<YYYYMMDD>-<HHMMSS>-<hex>`) |
| `${run_dir}` | Absolute path to the run artifacts directory |
| `${date}` | Run date formatted as YYYYMMDD |
| `${rule_targets}` | Comma-separated rule targets from `--rule-targets` flag, `config.ruleTargets`, or default `"agentsmd"` |

### Services/Functions

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/cli.ts` | `runCli()` | CLI entry point, parses `init` subcommand |
| `src/engine/runner.ts` | `runFlow()` | Executes the loaded flow definition |
| `src/engine/loader.ts` | `loadFlow()` | Loads `flows/init.flow.yaml` |
| `src/scripts/parse-plan.ts` | `parsePlan()` | Extracts phases from the plan's YAML frontmatter |
| `src/scripts/generate-baseline.ts` | `generateBaseline()` | Writes `<docs_dir>/BASELINE` content manifest |
| `src/scripts/install-rules.ts` | `installRules()` | Installs documentation rule stubs into the app directory |
| `src/run-context.ts` | `createRunContext()` | Creates run ID and run directory |
| `src/templates.ts` | `renderPromptFile()` | Renders prompt templates with variables |

### Prompt Templates Used

| Template | Purpose |
|----------|---------|
| `prompts/document-architecture.md` | Generate architecture documentation |
| `prompts/plan-init.md` | Create the documentation plan |
| `prompts/slice-doc.md` | Document a single phase |
| `prompts/verify-domain-documentation.md` | Verify documentation quality |
| `prompts/fix-documentation.md` | Fix verification errors |
| `rules/rule-stub.md` | Rendered into the managed block for each rule target |
| `rules/cursor-rule.mdc` | Rendered as a full `.mdc` file for the `cursor` rule target |
| `rules/copilot-rule.md` | Rendered as a full `.instructions.md` file for the `copilot` rule target |

## Integration Points

- **Depends on**: Agent backend (Cursor, Copilot, or Claude), prompt templates in `prompts/`, rule templates in `rules/`, built-in scripts (`parse-plan`, `install-rules`, `generate-baseline`)
- **Used by**: Users starting documentation for a new project
- **External systems**: External agent CLIs (`cursor-agent`, `copilot`, `claude`)

## Extension Guide

To modify the init workflow:

1. **Add steps**: Edit `flows/init.flow.yaml` — insert new `agent`, `script`, or control flow steps at the desired position
2. **Change prompts**: Create a new template in `prompts/` and update the `prompt:` field in the flow step
3. **Adjust verify/fix iterations**: Change the `max:` value in the `loop` step (default is 3)
4. **Skip phase 0 handling**: Remove or modify the `when: '${phase.number} != 0'` filter on the foreach
5. **Add post-processing**: Insert steps after the `generate-baseline` script for any cleanup or reporting
