---
title: Project Configuration
type: concept
sources:
  - src/cli/config.ts
  - src/saaga-rules.ts
  - src/unstable-features.ts
  - src/cli.ts
terms:
  - .saaga/config.yaml
  - .saagarules
  - unstable feature
last_verified: 2026-09-01
---

# Project Configuration

## Business Definition

Everything a repository can say about how Saaga should treat it: which agent backend and
models to use, where the corpus lives, which rule files to install, whether to ask before
spending money, and any project-specific instructions the agent must follow. It is read
once per invocation, before any flow starts.

## Configuration

| Source | Precedence | Description |
|--------|------------|-------------|
| CLI flags | 1 (highest) | `--backend`, `--model`, `--rule-targets`, `--yes` override the file per field |
| `.saaga/config.yaml` | 2 | The project's own settings; an absent file means an empty config, not an error |
| Built-in default | 3 | `agentsmd` for rule targets, `saaga-docs` for the corpus directory, no auto-approval |

`.saaga/config.yaml` fields, all optional:

| Field | Validation |
|-------|------------|
| `defaultBackend` | Must be a string; the value itself is checked during [backend resolution](./backend-resolution.md) |
| `backends` | Mapping keyed by `cursor`, `copilot` or `claude`; each entry accepts only `models`, a mapping of model key to model name |
| `ruleTargets` | String or array of strings, normalized to a comma-separated string; selects the files [install-rules](../features/install-rules.md) writes |
| `docsDir` | Must be a string; defaults to `DEFAULT_DOCS_DIR` |
| `autoApprove` | Must be a boolean; skips the cost confirmation the same way `--yes` does |
| `unstableFeatures` | Array of strings, each a name in `UNSTABLE_FEATURES` |

Any violation throws `ConfigError` naming the offending key path; see
[error messages](../conventions/error-messages.md) for the phrasing.

An unstable feature is enabled for the whole process, not per call: every subcommand
validates the names from both sources, unions them with `resolveUnstableFeatures()`,
installs them with `initUnstableFeatures()`, and prints one `[WARN]` line naming the
enabled set. An unknown name in `--unstable-feature` exits 1; an unknown name in the
config file throws `ConfigError`. `UNSTABLE_FEATURES` currently holds only the
placeholder `none`, so the registry ships with nothing real to enable.

**How to access:**
- `loadConfig(projectDir)` - the parsed `SaagaConfig`, or `{}` when the file is missing
- `loadSaagaRules(projectRoot)` - returns the `.saagarules` text, or `undefined`
- `DEFAULT_DOCS_DIR` (constant) - the corpus directory used when `docsDir` is unset
- `SAAGA_RULES_FILE` (constant) - the rules filename, resolved against the project root

## Data Storage

| Artifact | Field/Property | Purpose |
|--------|-------|---------|
| `.saaga/config.yaml` | `SaagaConfig` | The six fields above, as a YAML mapping |
| `.saagarules` | file body | Free-form project instructions, appended to every agent prompt |
| `.saagaignore` | file body | Optional, user-created; its syntax and effect belong to [baseline and change detection](./baseline-and-change-detection.md) |

`.saagarules` sits at the project root, capped at 64 KiB. Absent, empty or whitespace-only
yields `undefined`; oversized, invalid UTF-8 or unreadable throws `SaagaRulesError` rather
than silently dropping the maintainer's instructions. `appendSaagaRules()` wraps the text
in a bounded-priority section ranking it high but below output formats, file paths and
permission constraints — see [prompt templates](./prompt-templates.md) for where it lands.

## Key Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `cli/config` | `loadConfig()` | Reads and validates `<projectDir>/.saaga/config.yaml` |
| `cli/config` | `SaagaConfig`, `BackendConfig` | The validated shape a loaded config has |
| `cli/config` | `ConfigError` | Thrown for malformed YAML or an invalid field |
| `saaga-rules` | `loadSaagaRules()` | Reads, size-checks and UTF-8-validates `.saagarules` |
| `saaga-rules` | `appendSaagaRules()` | Appends the rules section to a rendered prompt |
| `saaga-rules` | `SaagaRulesError` | Thrown when `.saagarules` exists but cannot be used |
| `unstable-features` | `isUnstableFeature()` | Type guard for a known feature name |
| `unstable-features` | `findUnknownFeature()` | First unrecognized name in a list, if any |
| `unstable-features` | `resolveUnstableFeatures()` | Unions config and CLI names, first-seen order |
| `unstable-features` | `initUnstableFeatures()` | Replaces the process-wide enabled set |
| `unstable-features` | `getEnabledUnstableFeatures()` | The enabled set, sorted, for the warning line |
| `unstable-features` | `resetUnstableFeatures()` | Clears the set; test isolation only |

## Internal Implementation

> - `cli/config.parseBackendConfig()` - rejects any key under a backend other than
>   `models`, and maps the removed `modelLow`/`modelMedium`/`modelHigh` fields to a
>   migration hint naming their `models.<key>` replacement rather than a generic error.

> **Observation:** unknown keys *under* `backends.<backend>` are rejected, but unknown
> keys at the top level of the file are ignored. This may be intentional or a bug.

## Reference Implementations

- `src/cli/config.ts` - the whole load-and-validate path, one guarded block per field
- `src/cli.ts` - `bootstrapUnstableFeatures()`, the shared subcommand preamble
- `tests/cli/config.test.ts` - the accepted and rejected shapes, field by field

## Related Concepts

- [Backend Resolution](./backend-resolution.md)
- [Run Context](./run-context.md)
- [Feature: CLI Entry Point](../features/cli-entry-point.md)
