---
title: "Feature: Navigation Generation"
type: feature
last_verified: 2026-09-01
sources:
  - src/docs/navigation.ts
  - src/scripts/generate-navigation.ts
terms:
  - INDEX row
---

# Feature: Navigation Generation

## Overview

The corpus's entry point and glossary, derived from the category `INDEX.md` files rather than
written by an agent. `README.md` gives a reading order and `GLOSSARY.md` gives every indexed
term the definition its INDEX row gives it, verbatim — so neither page can rot independently
of its source, or invent a definition.

## Key Concepts

Before working with this feature, understand these concepts:
- [Corpus Documents](../concepts/corpus-documents.md)
- [Script Registry](../concepts/script-registry.md)

## Functional Specification

### Mechanism

1. Every Markdown file under the docs root is read, and the two generated files are dropped
   from that view first — otherwise the glossary, which links every document, would feed its
   own link counts into the next run's ranking.
2. Each `INDEX.md` is parsed for **INDEX rows**. Indexes are visited in category order —
   concepts, patterns, conventions, features, then anything else, sorted — and the resulting
   sequence is the corpus's **index order**, which breaks every downstream tie.
3. Terms are collected — each row's link text, plus every name a document declares in its
   frontmatter `terms` — and defined by the owning row's description, verbatim. They group
   case-insensitively, spelled as their lowest-order home spells them; a term with several
   homes becomes plain text with a "see also" sub-bullet each.
4. Inbound links are counted, ignoring links from the generated files and a document's links
   to itself. Concept rows are ranked by that count, ties broken by index order, and the top
   four become the README's core concepts.
5. The README is assembled — an architecture link, those concepts, every feature row in index
   order, one link per category INDEX plus the glossary — and both files are written with
   `type: index` frontmatter. Generation is pure: same input bytes, same output bytes.
6. Content defects only warn: ten of them, then a count of the rest. Structural failure is
   [`validate-docs`'s](./corpus-gates.md) job, and it runs next — so it link-checks this
   generator's own output too.

### Validation Rules

- An INDEX row is exactly `| [Display Name](./slug.md) | description |`, matched by anchoring
  on the final pipe rather than by splitting, so an escaped `\|` survives. Rows inside fenced
  blocks are skipped as examples; a pipe line carrying a link that parses as no row is
  reported, while the link-less header and separator rows are not defects.
- A row whose target is not a corpus document, or does not exist, is reported and dropped
  rather than copied into a generated page — `validate-docs` runs next and would turn a stale
  row into an untraceable abort. Duplicates and empty descriptions are reported. So is a
  document declaring `terms` with no INDEX row: no definition to copy, so none is invented.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Docs directory empty, or no `INDEX.md` anywhere | Nothing is written; the second case warns |
| No `ARCHITECTURE.md` | The README omits its section, and the absence is reported |
| A document has no `title` and no `#` heading | Its display name falls back to the basename; it is never invented |

## Technical Implementation

### Data Model

| Artifact | Key Fields | Purpose |
|--------|------------|---------|
| `<docs_dir>/README.md` | Architecture, Core Concepts, Workflows and Features, Indexes | The corpus entry point and reading order |
| `<docs_dir>/GLOSSARY.md` | One bullet per term, with its verbatim definition | Every indexed term and where it is defined |

Both are regenerated on every run and **must never be hand-edited**: change the INDEX row.

### Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `docs/navigation` | `buildNavigation()` | The whole layer in memory: rows, terms, ranking, both rendered files |
| `docs/navigation` | `parseIndex()`, `collectIndexRows()`, `collectTerms()`, `countInboundLinks()`, `rankCoreConcepts()`, `docTitle()` | The pieces: INDEX parsing, index order, glossary entries, ranking, display names |
| `docs/navigation` | `renderReadme()`, `renderGlossary()`, `README_FILE`, `GLOSSARY_FILE`, `GENERATED_FILES`, `CATEGORY_ORDER`, `CORE_CONCEPT_COUNT` | Rendering, kept separate from the model, and the constants that fix the two orderings |
| `scripts/generate-navigation` | `generateNavigation()`, `GenerateNavigationResult` | The step: read, build, warn, write, report counts |

## Integration Points

- **Depends on**: the [link graph and frontmatter](../concepts/corpus-documents.md) it reads
  the corpus through, and the [script contract](../concepts/script-registry.md).
- **Used by**: every bundled flow, one step before `validate-docs` — see
  [corpus gates](./corpus-gates.md).
- **External systems**: none.

## Extension Guide

The generated pages are model-then-render: add a section by extending `ReadmeModel` and
`renderReadme()`, taking its content from an INDEX row or a document heading rather than
authoring prose in code — the module's few authored strings are constants precisely so they
cannot drift. Anything new that reads the corpus goes through the shared `extractLinks()`
and `resolveLinkTarget()`, never a second resolver of its own.
