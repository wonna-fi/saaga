# Flow Definitions

## Business Definition

Flow definitions are the YAML-based workflow files that define the step sequences for each Saaga command. Each flow file describes what the command does end-to-end — which agent prompts to invoke, which scripts to run, and how to control iteration and branching. The four flows (`init`, `update`, `quick-update`, `verify-quick-updates`) map 1:1 to CLI subcommands.

## Configuration

| Source | Description |
|--------|-------------|
| `flows/*.flow.yaml` | One file per workflow; the file name (minus `.flow.yaml`) is the flow's identity |
| `FLOWS_DIR` constant in `src/paths.ts` | Absolute path to the `flows/` directory at runtime |

**How to access:**
- `loadFlow(name)` - loads and parses `flows/<name>.flow.yaml` into a typed `FlowDefinition`
- `loadFlowFromFile(path)` - loads a flow from an arbitrary file path
- `FLOWS_DIR` (constant) - the resolved directory containing all flow files

## Data Storage

| Object/Model/Type | Field/Property | Purpose |
|--------|-------|---------|
| `FlowDefinition` | `name` | Identifier for the flow (matches the YAML `name:` field) |
| `FlowDefinition` | `steps` | Ordered array of `Step` objects composing the workflow |

## The Four Flow Files

| Flow | File | Purpose |
|------|------|---------|
| init | `flows/init.flow.yaml` | Full documentation generation: architecture → plan → phases → baseline |
| update | `flows/update.flow.yaml` | Incremental update: detect changes → plan → phases → baseline |
| quick-update | `flows/quick-update.flow.yaml` | Fast single-session documentation update: detect changes → agent-driven triage/update → archive → baseline |
| verify-quick-updates | `flows/verify-quick-updates.flow.yaml` | Batch verification: collect unverified quick-update artifacts → plan → foreach phase (slice + verify/fix) → remove artifacts |

### init.flow.yaml

The most complex flow. Step sequence:

1. `agent` — generate architecture docs (`document-architecture`)
2. `agent` — create a documentation plan (`plan-init`), with `expect_file` assertion
3. `script` — `parse-plan` extracts phases from the plan's YAML frontmatter
4. `agent` — document phase 0 (`slice-doc`)
5. `script` — `install-rules` installs rule stubs using `${app_path}`, `${app}`, and `${rule_targets}` from scope
6. `foreach` — iterate non-zero phases: document each with `slice-doc`, then enter a `loop` (max 3) of verify → read-status → conditionally fix
7. `script` — `generate-baseline` creates the content manifest

### update.flow.yaml

Conditional workflow for incremental updates:

1. `script` — `detect-changes` compares work tree vs. BASELINE
2. `if` — only proceeds when `${changes.count} != 0`
3. Inside the `if`: plan → parse-plan → foreach phase (slice + verify/fix loop) → regenerate baseline

### quick-update.flow.yaml

Fast single-session update using a cheaper/faster model by default. Step sequence:

1. `script` — `detect-changes` compares work tree vs. BASELINE; stores result as `changes`
2. `if` — only proceeds when `${changes.count} != 0`
3. Inside the `if`:
   - `agent` — `quick-update` prompt: triage changes, update docs, write status (`UPDATED`/`SKIPPED`) and summary artifact
   - `read-file` — reads the status file into scope as `status`
   - `if` — when `${status} == "UPDATED"`: runs `archive-quick-update` with `summary_path`; the script verifies the summary exists before copying the changes report into the quick-update metadata folder
   - `script` — `generate-baseline` regenerates the content manifest

### verify-quick-updates.flow.yaml

Batch verification flow that consolidates and hardens accumulated quick-update artifacts. Step sequence:

1. `script` — `collect-quick-updates` snapshots all unverified metadata folders; stores result (including `manifest_path` and `count`) as `quick_updates`
2. `if` — only proceeds when `${quick_updates.count} != 0`
3. Inside the `if`:
   - `agent` — `plan-verify-quick-updates` prompt: reads all artifact summaries, consolidates into a verification plan
   - `script` — `parse-plan` extracts phases from the plan
   - `foreach` — iterate phases: document each with `slice-doc`, then enter a `loop` (max 3) of verify → read-status → conditionally fix
   - `script` — `remove-quick-updates` deletes exactly the metadata folders listed in the manifest (artifacts created after the snapshot are preserved)

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/engine/loader.ts` | `loadFlow()` | Load a flow by name from `FLOWS_DIR` |
| `src/engine/loader.ts` | `loadFlowFromFile()` | Load a flow from an arbitrary file path |
| `src/engine/loader.ts` | `parseFlowDefinition()` | Parse a raw YAML object into a typed `FlowDefinition` |
| `src/engine/runner.ts` | `runFlow()` | Execute a `FlowDefinition` with initial scope and dependencies |
| `src/paths.ts` | `FLOWS_DIR` | Resolved absolute path to `flows/` directory |

## Reference Implementations

- `flows/init.flow.yaml` — demonstrates all step types: agent, script, foreach (with `when`), loop, read-file, if
- `flows/update.flow.yaml` — demonstrates conditional branching with `if` at the top level and nested `foreach`/`loop`
- `flows/quick-update.flow.yaml` — demonstrates agent writing a status file that controls conditional archiving
- `flows/verify-quick-updates.flow.yaml` — demonstrates collecting external artifacts, planning from them, and cleaning up afterwards

## Related Concepts

- [Flow DSL](./flow-dsl.md)
- [Scope and Expressions](./scope-and-expressions.md)
- [Templates and Prompt Rendering](./templates-and-prompt-rendering.md)
- [Prompt Templates](./prompt-templates.md)
