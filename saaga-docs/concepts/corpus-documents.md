---
title: Corpus Documents
type: concept
last_verified: 2026-09-01
sources:
  - src/docs/frontmatter.ts
  - src/docs/link-graph.ts
  - src/docs/validate.ts
  - src/docs/format-version.ts
terms:
  - corpus
  - frontmatter
  - document type
  - orphan
  - broken link
  - format version
---

# Corpus Documents

## Business Definition

The **corpus** is the documentation tree Saaga writes and maintains: a directory of
Markdown documents, each one a *document* in a specific sense — it carries machine-readable
**frontmatter**, it belongs to exactly one category, and it is reachable from the rest.
Those three properties are what let later runs find the documents a source change
invalidates, generate navigation without inventing anything, and refuse a corpus that has
structurally decayed.

Everything here is about a document's *shape*. Which checks are fatal in a run, and when,
belongs to [corpus gates](../features/corpus-gates.md).

## Data Storage

| Artifact | Fields | Purpose |
|--------|-------|---------|
| `<docs_dir>/{concepts,patterns,conventions,features}/` | An `INDEX.md` plus one file per document | The four categories; `conventions/` exists only where there are lexical rules to state |
| `<docs_dir>/ARCHITECTURE.md` | — | The system-level document every other one is measured against |
| `<docs_dir>/README.md`, `GLOSSARY.md` | — | Generated; see [navigation generation](../features/navigation-generation.md) |
| `<docs_dir>/FORMAT` | `format_version: <integer>` | The corpus's own format identity, carried with it wherever it is copied |
| `<docs_dir>/metadata/` | Run artifacts | Archived evidence, never navigated to, and pruned from the link graph |
| Document frontmatter | `title`, `type`, `last_verified?`, `sources?`, `terms?` | Per-document metadata, at the top of every file |

### Frontmatter

| Field | Rule |
|-------|------|
| `title` | Required. A non-empty string; the document's display name |
| `type` | Required. One of `concept`, `pattern`, `convention`, `feature`, `architecture`, `index` |
| `last_verified` | Optional. ISO `YYYY-MM-DD`. Written **only** by a verification pass that found nothing wrong; its absence is how the pipeline marks a document as pending |
| `sources` | Optional. The source paths or globs whose behaviour the document's claims cover — the list to re-read to check whether it is still true |
| `terms` | Optional. Extra names the document is the home for. The definition is never written here: the glossary copies the document's INDEX row description verbatim |

Parsing collects problems instead of throwing, so one malformed document cannot abort a
whole-corpus pass. A file with no leading `---` block at all is not an error — pre-beta
corpora have none and must keep flowing through every command — and yields
`frontmatter: null` with its content untouched. An unusable `title` or `type` also yields
`null`, because nothing downstream can do anything with a partially typed document; an
optional field that fails validation is dropped and reported. Round-tripping through
`serializeDoc()` emits fields in schema order with `terms` last, so re-serialising an
existing document does not rewrite its bytes.

### The link graph

A **link** is an inline `[text](target)` or `![alt](target)`. Links inside fenced code
blocks and inline code spans are examples, not navigation, and are skipped; reference-style
links, autolinks and raw HTML anchors are not recognised at all, because the corpus does
not use them. A target is resolved relative to the document containing it, with any
`#anchor` or `?query` suffix stripped — the anchor itself is not checked. External,
protocol-relative, pure-anchor and root-absolute targets address no corpus document and are
left alone.

A **broken link** is a resolved target that does not exist on disk. Existence is a probe
rather than a lookup in the document set, because a link out of the corpus into real source
(`../src/cli.ts`) is legitimate and must still be checked.

An **orphan** is a document no *other* document links to — a document does not de-orphan
itself. Every `INDEX.md` and a docs-root `README.md` are entry points by definition and are
exempt. `ARCHITECTURE.md` deliberately is not: the navigation layer links it from the
generated README, and this check is the proof that happened.

### Structural validity

- **Broken links** — every resolved target must exist.
- **Mermaid diagrams** — each ` ```mermaid ` fence must be closed, non-empty, and open with
  a recognised diagram keyword; a `flowchart`/`graph` must carry a valid direction and no
  unclosed node brackets. The check is a deliberately shallow hand-rolled parse: Saaga does
  not depend on Mermaid, and failing a *valid* diagram would abort a flow whose corpus is
  already on disk.
- **Convention body cap** — a document directly under `conventions/`, `INDEX.md` aside, may
  carry at most `CONVENTION_MAX_BODY_LINES` (20) lines of body, frontmatter and surrounding
  blank lines excluded. Unlike the [line budgets](./corpus-budget.md), which a verifying
  agent applies with tolerance, this is a hard cap in code: a convention that grows is a
  convention turning back into a pattern.
- **Orphans** — reported, but a document nothing links to is still correct.

### Format version

`FORMAT` stamps the corpus with the layout, templates and frontmatter schema the build of
Saaga that wrote it uses; `CURRENT_FORMAT_VERSION` is 1. Reading it resolves three states:
no corpus at all (docs directory absent or empty), a corpus at version 0 (populated but
unstamped, so predating the stamp), or a corpus at a stated version. That first
distinction is load-bearing — an empty directory is a greenfield `init` target, while an
unstamped one is a pre-beta corpus every update-family flow must refuse.

## Key Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `docs/frontmatter` | `parseDoc()`, `serializeDoc()` | Split a document into frontmatter and body, and put it back |
| `docs/frontmatter` | `DocFrontmatter`, `DocType`, `ParsedDoc`, `DOC_TYPES` | The schema and the recognised types |
| `docs/link-graph` | `listDocFiles()` | Every `.md` under the docs root, sorted, dot-directories and `metadata/` pruned |
| `docs/link-graph` | `extractLinks()`, `resolveLinkTarget()` | The one link extractor and the one resolver every corpus reader uses |
| `docs/link-graph` | `extractMermaidFences()`, `FenceScanner` | Diagram extraction, and the fence tracking shared with the INDEX parser |
| `docs/validate` | `validateCorpus()`, `validateMermaidFence()` | Every structural check, collected into a `ValidationReport` |
| `docs/validate` | `CONVENTION_MAX_BODY_LINES`, `MERMAID_DIAGRAM_TYPES` | The cap and the recognised diagram keywords |
| `docs/format-version` | `readFormatVersion()`, `writeFormatVersion()` | Read and write the stamp |
| `docs/format-version` | `CURRENT_FORMAT_VERSION`, `FORMAT_FILE` | What this build writes, and where |

## Reference Implementations

- `src/docs/frontmatter.ts` - the schema and its collect-don't-throw validation
- `src/docs/validate.ts` - every structural rule, each with the reasoning for its scope
- `tests/docs/link-graph.test.ts` - what counts as a link, case by case
- `tests/docs/validate.test.ts` - the orphan, diagram and convention-cap contracts

## Related Concepts

- [Corpus Budget](./corpus-budget.md)
- [Feature: Corpus Gates](../features/corpus-gates.md)
- [Feature: Navigation Generation](../features/navigation-generation.md)
- [Project Configuration](./project-configuration.md) — where the docs directory is named
