---
generated: 2026-08-23T01:20:00Z
verified: false
docs_touched:
  - saaga-docs/ARCHITECTURE.md
  - saaga-docs/concepts/cost-confirmation.md
  - saaga-docs/concepts/flow-definitions.md
  - saaga-docs/concepts/flow-dsl.md
  - saaga-docs/features/INDEX.md
  - saaga-docs/features/agent-invocation.md
  - saaga-docs/features/change-detection.md
  - saaga-docs/features/cli-entry-point.md
  - saaga-docs/features/doctor.md
  - saaga-docs/features/flow-execution.md
  - saaga-docs/features/flow-loading-and-validation.md
  - saaga-docs/features/init-workflow.md
  - saaga-docs/features/quick-update-workflow.md
  - saaga-docs/features/update-workflow.md
  - saaga-docs/features/verify-quick-updates-workflow.md
  - saaga-docs/patterns/INDEX.md
  - saaga-docs/patterns/adding-cli-subcommands.md
confidence: medium
---

## What changed

Document-worthy code changes since BASELINE center on a CLI UX restructure and flow metadata:

1. **`saaga run <flow>`** — Bundled flows (`init`, `update`, `quick-update`, `verify-quick-updates`) are no longer top-level Commander commands. They are invoked via `saaga run`. Omitting the flow name lists available flows. Legacy top-level names remain as hidden stubs that throw `DeprecatedCommandError` with a migration message.
2. **Optional flow `description`** — `FlowDefinition` / YAML `description:` is parsed and shown in the `saaga run` listing. All four bundled flows include descriptions.
3. **Loader APIs** — New exported `listFlows()`, `flowExists()`, and `FlowInfo` support discovery and validation for the `run` command.
4. **Cost notice wording** — `buildCostNotice()` now phrases the disclaimer as `'saaga run <flow>' will run the …`.

Test-only files, plans, README/DEVELOPING, and GitHub workflow YAML were treated as non-domain-doc surfaces (or already reflected via the CLI/flow docs above).

## What was updated

- **features/cli-entry-point.md** — Documented three top-level commands (`run`, `install-rules`, `doctor`); `saaga run` user flow (list / unknown flow / execute); bundled-flow table; `DeprecatedCommandError` edge cases and error handling; extension guide points at flow-first pattern.
- **features/INDEX.md** — CLI entry description updated for `run` / flow listing.
- **ARCHITECTURE.md** — CLI module section updated for `run`, listing via `listFlows()`, and legacy stubs.
- **concepts/flow-dsl.md** / **flow-definitions.md** — Optional `description`; `listFlows` / `flowExists` / `FlowInfo`; flows executed via `saaga run`.
- **features/flow-loading-and-validation.md** — `description` validation; `listFlows` / `flowExists` entry points and services table; `saaga run` as caller.
- **concepts/cost-confirmation.md** — Triggered by `saaga run <flow>`; notice format mentions `saaga run`.
- **Workflow / related features** (`init`, `update`, `quick-update`, `verify-quick-updates`, `change-detection`, `agent-invocation`, `flow-execution`, `doctor`) — Invocation examples and “used by” / services wording switched to `saaga run …`.
- **patterns/adding-cli-subcommands.md** (+ INDEX) — Rewritten for flow-first addition (`flows/*.flow.yaml` discovered by `listFlows()`); non-flow top-level commands remain the exception.

## Uncertainty areas

- **features/cli-entry-point.md — Edge Cases / Internal Implementation naming**: Pre-existing docs use many alternate identifiers (`runCli` vs source `runCli`, flag names, config paths). This pass updated the `run` / deprecation behavior against `src/cli.ts` but did not fully re-audit every unrelated symbol name in that file. `verify-quick-updates` should confirm `DeprecatedCommandError` message text and whether edge-case error strings still match runtime.
- **concepts/cost-confirmation.md — prompt / auto-approve copy**: Source uses `Continue? [y/N] `, `Confirmation auto-approved.`, and `.saaga/config.yaml`; the concept doc still carries some pre-existing wording drift in the confirmation-flow section. Only the `saaga run` framing and `buildCostNotice` lead-in were intentionally updated here.
- **Shallow git history**: Repo appears as a single squash commit, so BASELINE-vs-tree diffs could not be recovered as historical blobs; triage relied on the changes report plus current source.
