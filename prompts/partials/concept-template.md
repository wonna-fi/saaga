### CONCEPT TEMPLATE

File location: `{docs_dir}/concepts/{concept-name}.md`

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

## Configuration

| Source | Description |
|--------|-------------|
| `{config source}` | {What is configured here} |

**How to access:**
- `{ServiceOrModule}.{method}()` - {what it returns}
- `{ServiceOrModule}.{CONSTANT_NAME}` (constant) - {what it contains}

> **Note:** Distinguish between methods/functions (use `()`) and properties/constants (no parentheses, add type in parentheses).

## Data Storage

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
