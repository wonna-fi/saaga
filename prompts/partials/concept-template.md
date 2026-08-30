### CONCEPT TEMPLATE

File location: `{docs_dir}/concepts/{concept-name}.md`

A concept answers "what is this and where does it live".
A concept does not narrate process: when a mechanism needs describing step by
step, that belongs in the feature document covering it — link to it from Related
Concepts instead.

`Configuration` and `Data Storage` are optional. Include either one only when the
concept genuinely has it; a concept with nothing to configure and no persisted
shape omits the heading entirely rather than filling it with something adjacent.

```markdown
---
title: {Concept Name}
type: concept
sources:
  - {source path or glob this concept describes}
---

# {Concept Name}

## Business Definition

{1-2 sentences explaining what this concept means from a business perspective}

## Configuration (optional)

| Source | Description |
|--------|-------------|
| `{config source}` | {What is configured here} |

**How to access:**
- `{ServiceOrModule}.{method}()` - {what it returns}
- `{ServiceOrModule}.{CONSTANT_NAME}` (constant) - {what it contains}

> **Note:** Distinguish between methods/functions (use `()`) and properties/constants (no parentheses, add type in parentheses).

## Data Storage (optional)

| Object/Model/Type | Field/Property | Purpose |
|--------|-------|---------|
| `{ModelName}` | `{fieldName}` | {What this field stores} |

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `{ModuleName}` | `{method}()` | {What it does} |

> **IMPORTANT:** Only list functions/methods that are part of the public API (exported, public visibility, etc.). Verify by checking the source file.

## Internal Implementation (optional)

> Include this section only for mechanisms that pass the consequence test. Omit it
> entirely otherwise — most documents should not have one.
>
> - `{module}.{internalFunction}()` - {what it demonstrates and why it matters}

## Reference Implementations

- `{FileName}` - {brief description of what the file demonstrates}
- `{ModuleName}.{publicFunction}()` - {brief description}

> **Note:** For internal/private functions, reference the file, not the function directly.

## Related Concepts

- [{Related Concept}](./related-concept.md)
```
