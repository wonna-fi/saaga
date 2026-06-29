# Feature: Install Rules

## Overview

The `install-rules` command installs always-on documentation rules into an application directory. It writes a documentation guidance block into agent rule files (e.g., `AGENTS.md`, `CLAUDE.md`, Copilot instructions, or Cursor `.mdc` rules), telling agents to read `<docs_dir>/` before exploring source code.

The operation is deterministic and idempotent: existing managed blocks are replaced in-place; owned files (Cursor `.mdc` and Copilot `.instructions.md`) are overwritten; missing parent directories are created. No agent backend is required.

This feature is also invoked as a step in the `init` workflow immediately after phase-0 documentation.

## Key Concepts

- [Script Registry](../concepts/script-registry.md) — `install-rules` is a registered built-in script
- [Package Paths](../concepts/package-paths.md) — `RULES_DIR` provides the template root

## Functional Specification

### Rule Targets

| Target | File Written |
|--------|-------------|
| `agentsmd` | `AGENTS.md` (managed block upsert) |
| `cursor` | `.cursor/rules/domain-docs.mdc` (full file, overwritten) |
| `claude` | `CLAUDE.md` (managed block upsert) |
| `copilot` | `.github/instructions/domain-docs.instructions.md` (full file, overwritten) |

### Managed Block Protocol

For `agentsmd` and `claude` targets, the rule stub content is wrapped in HTML comment markers and upserted into the target file:

- **File missing**: created with just the managed block.
- **File exists, block present**: the block between `<!-- saaga:begin -->` and `<!-- saaga:end -->` is replaced in-place; surrounding content is preserved.
- **File exists, no block**: the block is appended (with appropriate separator).

The `cursor` and `copilot` targets use standalone files rendered from their respective owned templates and are always fully overwritten.

### User Flow (CLI subcommand)

1. User runs `saaga install-rules [dir] [--rule-targets <targets>]` (dir defaults to the current working directory)
2. `<targets>` is a comma-separated list; `none` is a valid value that yields an empty list.
3. CLI validates targets — throws on unknown values before any file I/O occurs.
4. For each rule target: creates parent directories as needed, then writes or upserts the rule stub.

### Validation Rules

- `--rule-targets` values must be from: `agentsmd`, `cursor`, `claude`, `copilot`, `none`
- `app_dir` must be a non-empty string (required argument)
- `app` must be a non-empty string (required argument)
- `rule_targets` must be provided (empty string throws)

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| `--rule-targets none` | No rule files written (no-op) |
| Target file directory does not exist | Created recursively via `mkdir` |
| Managed block markers are split (begin without end) | Treated as no block found; stub is appended |
| Unknown target value | Throws `Error: install-rules: invalid rule target '<value>' (allowed: agentsmd, cursor, claude, copilot, none)` |

## Technical Implementation

### Templates Used

| Template | Purpose |
|----------|---------|
| `rules/rule-stub.md` | Rendered with `{app}` and `{docs_dir}` → inserted as managed block in rule files |
| `rules/cursor-rule.mdc` | Rendered with `{app}`, `{rule_body}` → written as the full Cursor `.mdc` rule file |
| `rules/copilot-rule.md` | Rendered with `{app}`, `{rule_body}` → written as the full Copilot `.instructions.md` file |

### Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Export | Purpose |
|--------|-----------------|---------|
| `src/scripts/install-rules.ts` | `installRules()` | Main entry point; orchestrates rule file installation |
| `src/scripts/install-rules.ts` | `parseRuleTargets()` | Parse and validate a comma-separated rule target string |
| `src/scripts/install-rules.ts` | `RULE_TARGETS` | Tuple of valid rule target strings |
| `src/scripts/install-rules.ts` | `MANAGED_BLOCK_BEGIN` | HTML comment marker: `"<!-- saaga:begin -->"` |
| `src/scripts/install-rules.ts` | `MANAGED_BLOCK_END` | HTML comment marker: `"<!-- saaga:end -->"` |
| `src/scripts/install-rules.ts` | `RuleTarget` (type) | Union of valid rule target strings |
| `src/scripts/install-rules.ts` | `InstallRulesArgs` (interface) | Arguments accepted by `installRules()`: `app_dir`, `app`, `rule_targets`, `docs_dir` |

## Integration Points

- **Depends on**: `rules/` template files, `renderPromptFile()` for rendering templates
- **Invoked by**: `saaga install-rules` CLI subcommand; `install-rules` script step in `flows/init.flow.yaml`
- **Registered in**: `defaultScriptRegistry` in `src/scripts/registry.ts`
- **Does not require**: An agent backend or run context

## Extension Guide

- **Add a new rule target**: Add the target name to `RULE_TARGETS`, add an entry to `RULE_SPEC`, and add an owned template to `rules/` if the file format requires frontmatter.
- **Change the rule stub content**: Edit `rules/rule-stub.md`.
- **Change the Cursor rule**: Edit `rules/cursor-rule.mdc`.
- **Change the Copilot rule**: Edit `rules/copilot-rule.md`.
