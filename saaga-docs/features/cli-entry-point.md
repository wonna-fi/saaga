---
title: "Feature: CLI Entry Point"
type: feature
sources:
  - src/cli.ts
  - src/cli/confirm.ts
  - src/logger.ts
  - src/output.ts
terms:
  - cost notice
  - resume hint
  - run.log
last_verified: 2026-09-01
---

# Feature: CLI Entry Point

## Overview

The `saaga` command: three subcommands, the global flags they share, and the lifecycle of
a flow run from cost approval to the last line printed. It is the only place a user
touches Saaga directly.

## Key Concepts

Before working with this feature, understand these concepts:
- [Project Configuration](../concepts/project-configuration.md)
- [Backend Resolution](../concepts/backend-resolution.md)
- [Run Context](../concepts/run-context.md)
- [Agent Permissions](../concepts/agent-permissions.md)

## Functional Specification

### User Flow

1. The user runs `saaga <subcommand> [args] [flags]`. Global flags may appear anywhere and
   are read through commander's `optsWithGlobals()`.
2. Every subcommand starts the same way: the target directory is checked to exist and be a
   directory, `.saaga/config.yaml` is loaded, unstable feature names from config and flags
   are validated and installed, and one `[WARN]` line is printed if any are enabled.
3. For `run`, the flow name is checked against the bundled flows first of all — `saaga run`
   with no flow prints them and the usage line instead — and after step 2 the flow is
   loaded and the backend and one model per model key it asks for are resolved.
4. The cost notice is printed and, on an interactive terminal, confirmed. `--yes` or
   `autoApprove` prints `Confirmation auto-approved.`; a non-TTY stdin or `--ci` prints
   `Non-interactive terminal: continuing without confirmation.` and proceeds, since
   blocking would hang scripted and CI usage. Declining exits 1.
5. The resolved backend is preflighted; a failure points at
   `saaga doctor --backend <name>` and exits 1 without spending anything.
6. A run directory is created — or an earlier one reopened — `run.log` is opened inside it,
   and the banner names the subcommand, path, backend and models. A resumed run also
   reports its attempt number and how many steps are already done.
7. The permission profile is built and written to `permissions.json`, the initial scope is
   assembled, and the manifest is written as `running`.
8. The flow executes; see [flow execution](./flow-execution.md). Progress appears as one
   line per phase — a spinner while it is in flight, then a `[DONE]`, `[SKIP]`, `[FAIL]`
   or `[PASS]` marker and a duration.
9. On success the manifest is marked `completed`. On failure or interruption it records
   the status and the error message, and stderr gets `failed.` or `interrupted.` followed
   by the resume hint.
10. Whatever the outcome, the permission audit is flushed and summarized and the logger is
    disposed.

`install-rules` and `doctor` skip steps 3–10 entirely: neither creates a run directory,
only `run` is gated behind the cost confirmation, and `install-rules` deliberately works
without agent credentials.

### Validation Rules

- The directory argument must exist and be a directory: `Directory not found: <dir>` or
  `Not a directory: <dir>`.
- A named flow must exist; an unknown one is rejected with the list of available flows.
- `--resume` and `--continue` cannot be combined.
- With `--resume` the flow name is optional, so a lone positional naming no flow is a
  directory.
- `--rule-targets` is validated where it is used — as `install-rules` starts, and as
  `run init` assembles its scope — against the targets
  [install-rules](./install-rules.md) accepts.
- `--model` values must be `<key>=<model>` with a key matching `MODEL_KEY_PATTERN`.
- An unknown `--unstable-feature` name is rejected with the list of known names.

### Flags

| Scope | Flags |
|-------|-------|
| Global | `-b, --backend <name>`, `--model <key=model>` (repeatable), `--ci`, `--verbose`, `-y, --yes`, `--allow-dir <path>` (repeatable), `--unstable-feature <name>` (repeatable), `--dangerously-allow-all`, `--audit-permissions`, `-v, --version` |
| `run [flow] [dir]` | `--rule-targets <targets>`, `--resume <run-id>`, `--continue` |
| `install-rules [dir]` | `--rule-targets <targets>` |
| `doctor` | `--level <fast\|full>` (default `fast`), `--json`, `--probe <ids...>` |

`doctor` deliberately does not redeclare `--backend` and `--model`: commander lets an
ancestor overwrite a subcommand copy, so a local `--model` would be clobbered by the
parent's empty default and silently discard everything it collected.

### Exit Codes

| Code | Cause |
|------|-------|
| 0 | Success, and `--help` / `--version` |
| 1 | Cost confirmation declined, preflight failure, unknown unstable feature, a moved subcommand, or any uncaught error |
| _agent's code_ | An agent step exited non-zero; that exit code is returned verbatim |
| 130 | The run was interrupted with Ctrl+C |
| _doctor's code_ | `doctor` returns the code its own report computes; see [doctor](./doctor.md) |

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Ctrl+C during a run | Cooperative shutdown: the agent child is asked to exit, the manifest records `interrupted`, the resume hint prints, exit 130. A second Ctrl+C exits immediately |
| Failure the run's own inputs decide | `NonResumableError` suppresses the resume hint, since replaying the journal would only repeat it |
| `saaga init`, `update`, `quick-update`, `verify-quick-updates` | Still accepted as hidden commands, and answered with `use: saaga run <name>` and exit 1 |
| `--dangerously-allow-all` | No permission profile is built; a warning says so, and `permissions.json` records mode `unrestricted` |
| `--audit-permissions` | Warned and ignored without a profile — nothing to judge denials against; with one, warns that agent output in `run.log` will be JSON for this run |
| A `docs/BASELINE` exists and `docsDir` is unset | Warns to set `docsDir: docs` or migrate the contents |
| Denial inside a granted path | Warned individually at the end of the run: the profile is wrong for this backend or CLI version, so the run quietly produced less than it should have |

## Technical Implementation

### Data Model

| Artifact | Key Fields | Purpose |
|--------|------------|---------|
| `<runDir>/run.log` | — | Every line the run produced, including the detail lines `--verbose` also puts on the terminal |
| `<runDir>/permissions.json` | `mode`, `profile` | The permission profile the run was granted, or `unrestricted` |
| `<runDir>/permission-audit.log` | — | Written only under `--audit-permissions`; the summary counts and the log path are logged at the end of the run |
| initial scope | `app`, `app_path`, `docs_dir`, `run_id`, `run_dir`, `date`, `iso_date` | What the CLI hands the engine; the `init` flow additionally gets `rule_targets` |

### Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `cli` | `runCli()` | Builds the commander program, dispatches, and maps every known error to an exit code |
| `cli` | `CliOptions` | Injection points for tests: an `Agent`, a cwd, the three streams, an abort signal |
| `cli/confirm` | `confirmAgentCosts()` | Prints the notice and asks `Continue? [y/N]` when interactive |
| `cli/confirm` | `buildCostNotice()` | The notice: subcommand, backend CLI, resolution, path, billing, per-subcommand cost hint |
| `cli/confirm` | `buildCostSummary()` | The one-line variant recorded in `run.log` |
| `cli/confirm` | `ConfirmationDeclinedError` | Declined confirmation, carrying exit code 1 |
| `logger` | `Logger` | Phase lines, `[INFO]`/`[WARN]`/`[ERROR]` lines, and indented children for nested steps |
| `logger` | `silentLogger()` | A logger that writes nowhere, for callers that want no output |
| `output` | `OutputSink` | The terminal and `run.log` writer behind `Logger` |
| `output` | `formatDuration()` | The duration formatting a phase line uses |

The per-subcommand cost hints are prose estimates in `src/cli/confirm.ts`, not computed
figures: `init` is described as the heaviest, `quick-update` as the lightest.

## Integration Points

- **Depends on**: [project configuration](../concepts/project-configuration.md),
  [backend resolution](../concepts/backend-resolution.md),
  [run context](../concepts/run-context.md), the
  [permission profile](../concepts/agent-permissions.md) and its auditor,
  [flow execution](./flow-execution.md), [install-rules](./install-rules.md), and
  [doctor](./doctor.md) for the preflight check.
- **Used by**: the `saaga` bin entry, which calls `runCli(process.argv.slice(2))` and exits
  with its return value; the end-to-end tests under `tests/cli/`, which call it directly
  with a fake agent and captured streams.
- **External systems**: the backend CLI binary, executed as a subprocess.

## Extension Guide

Add a subcommand by declaring it on the program in `src/cli.ts` with its own options,
starting its action with `bootstrapUnstableFeatures()` so it inherits directory
validation, config loading and the feature registry, and — if it can fail in a way worth
a distinct exit code — throwing a named error class with a readonly `exitCode` and adding
one branch for it to the `catch` in `runCli()`. Anything that spends model calls belongs
behind `confirmAgentCosts()`, and anything that runs a flow reuses `runFlowSubcommand()`
rather than assembling a run context by hand. Changing what a bundled flow *does* needs no
CLI change at all; see [extending workflows](../patterns/extending-workflows.md).
