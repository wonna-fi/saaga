# Flow Definitions

## Business Definition

Flow definitions are the YAML-based workflow files that define the step sequences for each Saaga command. Each flow file describes what the command does end-to-end — which agent prompts to invoke, which scripts to run, and how to control iteration and branching. The four bundled flows (`init`, `update`, `quick-update`, `verify-quick-updates`) are executed via `saaga run <flow>`. The `doctor` and `install-rules` subcommands do not use flows.

## Configuration

| Source | Description |
|--------|-------------|
| `flows/*.flow.yaml` | One file per workflow; the file name (minus `.flow.yaml`) is the flow's identity |
| `FLOWS_DIR` constant in `src/paths.ts` | Absolute path to the `flows/` directory at runtime |

**How to access:**
- `loadFlow(name)` - loads and parses `flows/<name>.flow.yaml` into a typed `FlowDefinition`
- `loadFlowFromFile(path)` - loads a flow from an arbitrary file path
- `listFlows()` - lists bundled flows (name + optional description) for `saaga run` with no flow argument
- `flowExists(name)` - checks whether a named flow file exists under `FLOWS_DIR`
- `FLOWS_DIR` (constant) - the resolved directory containing all flow files

## Data Storage

| Object/Model/Type | Field/Property | Purpose |
|--------|-------|---------|
| `FlowDefinition` | `name` | Identifier for the flow (matches the YAML `name:` field) |
| `FlowDefinition` | `description` | Optional human-readable summary (YAML `description:`); shown in `saaga run` flow listing |
| `FlowDefinition` | `steps` | Ordered array of `Step` objects composing the workflow |
| `FlowInfo` | `name`, `description?` | Lightweight listing entry returned by `listFlows()` |

## The Four Flow Files

| Flow | File | Purpose |
|------|------|---------|
| init | `flows/init.flow.yaml` | Full documentation generation: architecture → plan → phases → baseline |
| update | `flows/update.flow.yaml` | Incremental update: detect changes → plan → phases → baseline |
| quick-update | `flows/quick-update.flow.yaml` | Fast single-session documentation update: detect changes → agent-driven triage/update → archive → baseline |
| verify-quick-updates | `flows/verify-quick-updates.flow.yaml` | Batch verification: collect unverified quick-update artifacts → plan → foreach phase (slice + verify/fix) → remove artifacts |

### init.flow.yaml

The most complex flow. Every agent and script step has a `label:` field for the phase-progress display (control-flow steps like `foreach` and `loop`, and plumbing steps like `read-file`, do not have labels). Step sequence:

1. `script` — `ensure-gitignore` ensures `.saaga-runs/` is in the project's `.gitignore`; label: `ensuring .saaga-runs is gitignored`
2. `agent` — generate architecture docs (`document-architecture`); label: `documenting architecture`; passes `docs_dir`
3. `agent` — create a documentation plan (`plan-init`); label: `planning documentation`; passes `docs_dir`, with `expect_file` assertion
4. `script` — `parse-plan` extracts phases from the plan's YAML frontmatter; label: `parsing plan`
5. `agent` — document phase 0 (`slice-doc`); label: `documenting overview`
6. `script` — `install-rules` installs rule stubs; label: `installing rules`; uses `${app_path}`, `${app}`, `${rule_targets}`, and `${docs_dir}` from scope
7. `foreach` — iterate non-zero phases: document each with `slice-doc` (label: `documenting "${phase.title}"`), then enter a `loop` (max 3) of verify (label: `verifying "${phase.title}"`) → read-status → conditionally fix (label: `fixing "${phase.title}"`); `verify-domain-documentation` passes `docs_dir`
8. `script` — `generate-baseline` creates the content manifest; label: `generating baseline`; passes `docs_dir`

### update.flow.yaml

Conditional workflow for incremental updates. All agent and script steps have `label:` fields; the top-level `if` step has `label: updating documentation` and `skip_label: no changes detected` for the `[SKIP]` phase line when no changes are found:

1. `script` — `detect-changes` compares work tree vs. BASELINE; label: `detecting changes`; passes `docs_dir`
2. `if` — only proceeds when `${changes.count} != 0`; label: `updating documentation`; skip_label: `no changes detected`
3. Inside the `if`: plan (label: `planning update`; passes `docs_dir`) → parse-plan (label: `parsing plan`) → foreach phase (slice + verify/fix loop with `docs_dir`) → regenerate baseline (label: `generating baseline`; passes `docs_dir`)

### quick-update.flow.yaml

Fast single-session update using a cheaper/faster model by default. All agent and script steps have `label:` fields. Step sequence:

1. `script` — `detect-changes` compares work tree vs. BASELINE; label: `detecting changes`; passes `docs_dir`; stores result as `changes`
2. `if` — only proceeds when `${changes.count} != 0`; label: `quick updating documentation`; skip_label: `no changes detected`
3. Inside the `if`:
   - `agent` — `quick-update` prompt: label: `updating documentation`; passes `docs_dir`; triage changes, update docs, write status (`UPDATED`/`SKIPPED`) and summary artifact to `${app_path}/${docs_dir}/metadata/quick_updates/${run_id}/summary.md`
   - `read-file` — reads the status file into scope as `status`
   - `if` — when `${status} == "UPDATED"`: runs `archive-quick-update` (label: `archiving update`) with `dest_dir` using `${docs_dir}` in the metadata path
   - `if` — when `${status} != "UPDATED"`: runs `cleanup-quick-update-dir` (label: `cleaning up metadata`) to remove the pre-created metadata directory when the agent did not produce an update
   - `script` — `generate-baseline` regenerates the content manifest; label: `generating baseline`; passes `docs_dir`

### verify-quick-updates.flow.yaml

Batch verification flow that consolidates and hardens accumulated quick-update artifacts. All agent and script steps have `label:` fields. Step sequence:

1. `script` — `collect-quick-updates` snapshots all unverified metadata folders; label: `collecting quick updates`; stores result (including `manifest_path` and `count`) as `quick_updates`
2. `if` — only proceeds when `${quick_updates.count} != 0`; label: `verifying quick updates`; skip_label: `no quick updates to verify`
3. Inside the `if`:
   - `agent` — `plan-verify-quick-updates` prompt: label: `planning verification`; passes `docs_dir` and `metadata_dir` (`${app_path}/${docs_dir}/metadata/quick_updates`); reads all artifact summaries, consolidates into a verification plan
   - `script` — `parse-plan` extracts phases from the plan; label: `parsing plan`
   - `foreach` — iterate phases: document each with `slice-doc` (label: `documenting "${phase.title}"`), then enter a `loop` (max 3) of verify (label: `verifying "${phase.title}"`) → read-status → conditionally fix (label: `fixing "${phase.title}"`); `verify-domain-documentation` passes `docs_dir` and `changes_dir` (`${app_path}/${docs_dir}/metadata/quick_updates`)
   - `script` — `remove-quick-updates` deletes exactly the metadata folders listed in the manifest; label: `cleaning up artifacts` (artifacts created after the snapshot are preserved)

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/engine/loader.ts` | `loadFlow()` | Load a flow by name from `FLOWS_DIR` |
| `src/engine/loader.ts` | `loadFlowFromFile()` | Load a flow from an arbitrary file path |
| `src/engine/loader.ts` | `parseFlowDefinition()` | Parse a raw YAML object into a typed `FlowDefinition` |
| `src/engine/loader.ts` | `listFlows()` | List bundled flows (name + optional description) for `saaga run` |
| `src/engine/loader.ts` | `flowExists()` | Check whether a named flow file exists under `FLOWS_DIR` |
| `src/engine/loader.ts` | `FlowInfo` (interface) | Lightweight listing entry returned by `listFlows()` |
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
- [Output and Progress Display](./output-and-progress.md)
