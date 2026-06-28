# Feature: Plan Parsing

## Overview

The plan parsing feature extracts structured phase data from a documentation plan file's YAML frontmatter. This enables the flow engine to iterate over phases in a `foreach` loop, documenting each slice in sequence. It is the bridge between the agent-generated plan (a markdown file with YAML frontmatter) and the flow engine's control flow.

## Key Concepts

Before working with this feature, understand these concepts:
- [Script Registry](../concepts/script-registry.md) — `parse-plan` is a registered built-in script
- [Flow DSL](../concepts/flow-dsl.md) — the `ScriptStep` type and `set` mechanism for storing results in scope
- [Scope and Expressions](../concepts/scope-and-expressions.md) — how the returned `Phase[]` is accessed via `${phases}` and iterated with `foreach`

## Functional Specification

### User Flow

1. An agent step generates a documentation plan file (e.g., `<run_dir>/plans/<app>-init.plan.md`)
2. The flow invokes `parse-plan` with the plan file path
3. `parse-plan` reads the file, extracts the YAML frontmatter delimited by `---` fences
4. The YAML is parsed and the `phases` array is extracted
5. Each phase object is validated and coerced to `{ number: number, title: string }`
6. The resulting `Phase[]` array is stored in the flow scope (e.g., `set: phases`)
7. Subsequent `foreach` steps iterate over `${phases}`, accessing `${phase.number}` and `${phase.title}`

### Input Format

The plan file must have YAML frontmatter at the very beginning of the file, delimited by `---` lines:

```markdown
---
app: my-application
phases:
  - number: 0
    title: "Setup Structure"
  - number: 1
    title: "Core Concepts"
  - number: 2
    title: "API Layer"
---

# Documentation Plan

(rest of the plan content...)
```

The frontmatter must contain a `phases` array where each element has:
- `number` — a numeric value (integers and numeric strings like `"0"` are both accepted)
- `title` — a non-empty string

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| `file` arg is missing or empty | Throws `Error: parse-plan: 'file' arg is required` |
| File does not exist | Throws the Node.js file system error (ENOENT) |
| No YAML frontmatter (`---` fences) | Throws `Error: parse-plan: no YAML frontmatter found in <file>` |
| Frontmatter has no `phases` array | Throws `Error: parse-plan: missing or invalid 'phases' array in frontmatter of <file>` |
| A phase entry is not an object | Throws `Error: parse-plan: phase[<i>] in <file> must be an object` |
| Phase `number` is not numeric | Throws `Error: parse-plan: phase[<i>].number is not numeric in <file>` |
| Phase `title` is missing or empty | Throws `Error: parse-plan: phase[<i>].title is missing or empty in <file>` |
| Phase `number` is a numeric string (e.g., `"0"`) | Coerced to a number via `Number()` — treated identically to integer `0` |
| `phases` array is empty and `require_phases: "true"` | Throws `Error: parse-plan: 'phases' array is empty in frontmatter of <file>` |
| `phases` array is empty and `require_phases` unset | Returns an empty `Phase[]` array — caller is responsible for handling no-op |

## Technical Implementation

### Script Registration

Registered as `"parse-plan"` in `defaultScriptRegistry` (`src/scripts/registry.ts`).

### Flow YAML Usage

```yaml
- script:
    name: parse-plan
    file: ${run_dir}/plans/${app}-init.plan.md
    set: phases
```

The `file` key becomes `args.file` in the handler. The optional `require_phases` key controls empty-plan behaviour:

```yaml
- script:
    name: parse-plan
    file: ${run_dir}/plans/${app}-verify-quick-updates-${date}.plan.md
    require_phases: true
    set: phases
```

When `require_phases` is `"true"`, an empty `phases: []` array causes an immediate error. This is used by flows where an empty plan would cause data loss downstream (e.g., `verify-quick-updates` deletes metadata folders after processing — skipping verification silently would be destructive). Flows where an empty plan is a valid no-op (e.g., `update`) leave this unset.

All other keys besides `name`, `set`, and `commit` are collected as args by the loader.

### Services/Functions

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/scripts/parse-plan.ts` | `parsePlan()` | Main handler: reads file, extracts frontmatter, parses YAML, validates phases; respects `require_phases` to reject empty plans |
| `src/scripts/registry.ts` | `defaultScriptRegistry` | Registers `"parse-plan"` → `parsePlan` |

### Internal Implementation

| Function | Purpose |
|----------|---------|
| `extractFrontmatter()` in `src/scripts/parse-plan.ts` | Uses regex `/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/` to extract content between `---` fences |
| `coercePhase()` in `src/scripts/parse-plan.ts` | Validates and normalizes each phase object: coerces `number` to numeric, asserts `title` is a non-empty string |

### Return Value

Returns `Phase[]` — an array of `{ number: number, title: string }` objects. When used with `set: phases`, the array is stored in scope and accessed via:
- `${phases}` — the full array (used in `foreach: in`)
- `${phase.number}` — the phase number within a foreach iteration
- `${phase.title}` — the phase title within a foreach iteration

## Integration Points

- **Depends on**: `yaml` library for YAML parsing, `node:fs/promises` for file reading
- **Used by**: `flows/init.flow.yaml` (parses the init plan), `flows/update.flow.yaml` (parses the update plan), `flows/verify-quick-updates.flow.yaml` (parses the verification plan with `require_phases: true`)
- **Produces data for**: `foreach` steps that iterate over phases to document each slice

## Extension Guide

To modify plan parsing behavior:
- Edit the `coercePhase()` function in `src/scripts/parse-plan.ts` to accept additional phase fields
- Update the `Phase` interface to include new fields
- New fields will automatically be accessible in flow scope via `${phase.newField}` within `foreach` iterations
