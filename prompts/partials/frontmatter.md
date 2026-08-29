### DOCUMENT FRONTMATTER

Every document starts with a YAML frontmatter block, before the `#` title line.
It is machine-readable metadata: later runs use it to find documents whose
sources have changed since they were last verified.

```markdown
---
title: Scope and Expressions
type: concept
sources:
  - src/engine/expression.ts
  - src/engine/primitives/*.ts
---

# Scope and Expressions
```

Fields:

| Field | Required | Value |
|---|---|---|
| `title` | yes | The document's human-readable title — the same text as its `#` heading. |
| `type` | yes | One of `concept`, `pattern`, `feature`, `architecture`, `index`. |
| `sources` | yes, when the document makes claims about code | The source paths or globs whose behaviour this document's claims describe. Repository-relative. |
| `last_verified` | never write it yourself | ISO date (`YYYY-MM-DD`). Only the verification step sets this, and only on PASS. |

Rules:

- `type` follows the document's kind: `concept`, `pattern`, and `feature` match
  the directory the document lives in; INDEX.md files are `index`;
  ARCHITECTURE.md is `architecture`.
- `sources` is the list you would re-read to check whether this document is
  still true. List the files and globs the document actually describes — not
  every file you happened to open. An index that only links to other documents
  may omit `sources`.
- Never invent a `last_verified` date and never copy one from another document.
  A document you wrote or edited but did not verify has no `last_verified`.
