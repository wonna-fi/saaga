### PATTERN TEMPLATE

File location: `{docs_dir}/patterns/{pattern-name}.md`

````markdown
---
title: {Pattern Name}
type: pattern
sources:
  - {source path or glob this pattern describes}
---

# {Pattern Name}

## When to Use

{Describe the situations when this pattern should be used}

## Pattern

```{language}
// {Step-by-step code example with comments}
{code}
```

## Key Points

- {Important thing to remember}
- {Another important thing}

## Reference Implementations

| File | Function/Method | Notes |
| --- | --- | --- |
| `{FileName}` | `{functionName}()` | {What makes this a good reference} |

> **IMPORTANT:** Only list public/exported functions. For internal functions that show interesting patterns, reference the file instead.

## Anti-Patterns

**Do NOT:**

- {Common mistake to avoid}
- {Another mistake}
````
