---
title: "Feature: Install Rules"
type: feature
sources:
  - src/scripts/install-rules.ts
  - src/cli.ts
  - rules/rule-stub.md
  - rules/cursor-rule.mdc
  - rules/copilot-rule.md
terms:
  - managed block
last_verified: 2026-09-01
---

# Feature: Install Rules

## Overview

Writes the always-on rule that tells a coding agent to read the corpus before the source
into a repository's own agent-rule files, so any agent working there is pointed at the
documentation whether or not Saaga is running.

## Key Concepts

Before working with this feature, understand these concepts:
- [Project Configuration](../concepts/project-configuration.md)
- [Prompt Templates](../concepts/prompt-templates.md)

## Functional Specification

### Mechanism

1. `parseRuleTargets` splits the comma-separated list, drops `none`, removes duplicates
   while preserving order, and rejects anything else unknown. An empty result —
   `--rule-targets none` — writes nothing.
2. `rules/rule-stub.md` is rendered once with `app` and `docs_dir` and right-trimmed. That
   one body goes into every selected target.
3. Each target's parent directory is created and the body written the way its file needs:

| Target | File | Written as |
|--------|------|-----------|
| `agentsmd` | `AGENTS.md` | Managed block |
| `claude` | `CLAUDE.md` | Managed block |
| `cursor` | `.cursor/rules/domain-docs.mdc` | Whole file, from `rules/cursor-rule.mdc` |
| `copilot` | `.github/instructions/domain-docs.instructions.md` | Whole file, from `rules/copilot-rule.md` |

The split is ownership: `AGENTS.md` and `CLAUDE.md` usually hold the user's own content,
so only the marked region is touched, while the Cursor and Copilot files are
frontmatter-bearing formats — `alwaysApply: true` and `applyTo: "**"` — Saaga owns and
overwrites. Copilot's path-specific `.instructions.md` is used rather than
`.github/copilot-instructions.md` because it is the variant that takes frontmatter.

**Managed-block semantics.** The region is delimited by `<!-- saaga:begin -->` and
`<!-- saaga:end -->`. A missing file is created holding just the block; a file with both
markers has the text between them replaced and everything outside preserved byte for byte;
a file without markers gets the block appended after a blank line. Either way, idempotent.

### Validation Rules

- `app_dir`, `app`, `rule_targets` and `docs_dir` are all required, and unknown targets
  are rejected by name with the allowed set listed.
- Input carrying no token at all is an error rather than a silent no-op. The CLI calls the
  same parser while resolving the flag, so a bad value fails before the run starts.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| `none` listed among real targets | The `none` is dropped and the rest are installed |
| A user edited text inside the markers | Overwritten; only text outside them survives |

## Technical Implementation

### Data Model

| Model/Type | Key Fields | Purpose |
|--------|------------|---------|
| `InstallRulesArgs` | `app_dir`, `app`, `rule_targets`, `docs_dir` | The script step's arguments, all strings |

### Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `install-rules` | `installRules()` | The handler: renders the body and writes every selected target |
| `install-rules` | `parseRuleTargets()` | Parses and validates a comma-separated target list |

## Integration Points

- **Depends on**: [prompt templates](../concepts/prompt-templates.md) for rendering the
  rule body and the owned-file wrappers, and the
  [script registry](../concepts/script-registry.md) for dispatch.
- **Used by**: [the init workflow](./init-workflow.md) as a step, and
  [the CLI](./cli-entry-point.md) as `saaga install-rules`, which needs no agent backend.
  The selection comes from `--rule-targets`, then `ruleTargets` in
  [the config](../concepts/project-configuration.md), then `agentsmd`.

## Extension Guide

A new target is two edits in `src/scripts/install-rules.ts`: its name in `RULE_TARGETS`
and its entry in `RULE_SPEC`. Give it an `ownedTemplate` under `rules/` only when Saaga
owns the whole file; anything a user also writes in takes the managed block, which is what
an absent `ownedTemplate` means.
