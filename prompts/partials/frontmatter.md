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
| `terms` | no | Extra names this document is the home for — synonyms and sub-concepts a reader might look up. |

Rules:

- `type` follows the document's kind: `concept`, `pattern`, and `feature` match
  the directory the document lives in; INDEX.md files are `index`;
  ARCHITECTURE.md is `architecture`.
- `sources` is the list you would re-read to check whether this document is
  still true. The test is per claim, not per topic: **every file the document
  makes a signature or behavioural claim about belongs in `sources`**, including
  one cited only under "Reference Implementations". A file you merely opened
  while researching does not. An index that only links to other documents may
  omit `sources` entirely.
- Getting this wrong is not cosmetic. A claim whose file is missing from
  `sources` cannot be flagged when that file changes, so the document rots
  silently — which is the exact failure this metadata exists to prevent.
- Never invent a `last_verified` date and never copy one from another document.
  A document you wrote or edited but did not verify has no `last_verified`.
- `terms` lists *additional* names only: the document's INDEX row name is
  already a glossary term, so do not repeat it. List a name here when a reader
  would look it up and land nowhere — `phase`, `slice`, `scope`.
- Never write a definition for a `terms` entry. The glossary is generated and
  copies the document's INDEX row description verbatim, so a term whose
  document has no INDEX row is dropped rather than defined a second time.
