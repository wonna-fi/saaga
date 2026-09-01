---
title: Baseline and Change Detection
type: concept
last_verified: 2026-09-01
sources:
  - src/scripts/file-manifest.ts
  - src/scripts/generate-baseline.ts
  - src/scripts/detect-changes.ts
terms:
  - in scope
  - file manifest
  - BASELINE
  - .saagaignore
---

# Baseline and Change Detection

## Business Definition

The **file manifest** is the answer to "which files is this documentation about, and what
did they contain?" — every **in scope** file under the application directory, paired with
a git-compatible blob hash. Written to disk as `BASELINE`, it is the fingerprint a corpus
was generated from.

A later run recomputes the manifest and compares it with the stored one. Every difference
is classified, and the resulting count is what lets an update flow decide there is nothing
to do at all.

## Configuration

| Source | Description | Precedence |
|--------|-------------|------------|
| `.gitignore`, in any directory | Patterns excluded from the manifest, in gitignore syntax | Applied first at its own directory level |
| `.saagaignore`, in any directory | Files that are in git but not worth documenting; same syntax, including `!` re-inclusion | Merged after the co-located `.gitignore`, so it can override it |
| Built-in exclusions | `.git/`, `.saaga-runs/` and the docs directory (top-level directories only), every `.saagaignore` at any depth, and a root `.saagarules` | Win over both; no pattern can re-include them |

Ignore files compose the way git's do: the chain is evaluated shallow-to-deep, each
matcher tested against the path relative to its own directory, and the deepest matcher
with an opinion — ignored *or* explicitly un-ignored — decides. A nested `.saagaignore`
therefore overrides a root `.gitignore`, and the excluded paths a run hands its agent are
a separate question entirely, owned by
[agent permissions](./agent-permissions.md).

**How to access:**
- `computeManifest(appDir, docsDir)` - the sorted `{ hash, path }` entries
- `listInScopeFiles(appDir, docsDir)` - the same walk without hashing the bytes
- `gitBlobHash(buf)` - SHA-1 of `"blob <byteLength>\0<bytes>"`, matching `git hash-object`
- `fileExists(path)` (predicate) - whether a path is still a manifest-eligible entry

Symlinks are in scope and are hashed the way git stores them: the blob of the *link target
string*, never followed. Following one would hash the target's content, or throw on a
broken link, and would count an out-of-tree file as part of the project.

## Data Storage

| Artifact | Fields | Purpose |
|--------|-------|---------|
| `<docs_dir>/BASELINE` | `# Generated: <ISO timestamp>`, then one `<hash> <path>` line per file | The manifest as of the last documentation run |
| `<output_dir>/changes.md` | App name, baseline date, summary line, one section per classification | The human- and agent-readable change report |

`BASELINE` paths are POSIX-relative to the application directory and sorted, so two runs
over an unchanged tree produce byte-identical files. Comment lines and lines with no space
are skipped when it is read back, which is what makes the header line harmless.

### Change classification

`detect-changes` diffs the stored manifest against a freshly computed one and files every
difference under exactly one of four categories:

| Category | Meaning |
|----------|---------|
| `changed` | The path is in both manifests with a different hash |
| `new` | The path is in the current manifest only |
| `truly_deleted` | The path is in `BASELINE` only, and nothing is there on disk |
| `newly_ignored` | The path is in `BASELINE` only, but the file is still there — an ignore rule started matching it |

The last two are split by an `lstat` probe rather than by reading the ignore rules again,
so a directory that replaced a file reads as deleted rather than as still present. The
distinction matters to the reader of the report: a deleted file means documentation to
remove, while a newly ignored one means the same code is simply no longer in scope.

The handler returns `count` — the sum of all four — alongside `changes_path` and the four
individual counts, which is how a flow short-circuits on `${changes.count} == 0`. It
throws when `BASELINE` is missing, naming `init` as the fix: without a baseline there is
no "since" to detect changes against.

## Key Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `scripts/file-manifest` | `computeManifest()` | Walk, filter and hash; the definition of "in scope" |
| `scripts/file-manifest` | `listInScopeFiles()` | The same walk, paths only |
| `scripts/file-manifest` | `gitBlobHash()`, `fileExists()` | Hashing and the existence probe |
| `scripts/file-manifest` | `FileEntry` | `hash` and `path` |
| `scripts/generate-baseline` | `generateBaseline()` | Write `BASELINE`, creating the docs directory if needed |
| `scripts/detect-changes` | `detectChanges()` | Classify, report, and return the counts |
| `scripts/detect-changes` | `DetectChangesResult` | `count`, `changes_path`, and the four per-category counts |

## Reference Implementations

- `src/scripts/file-manifest.ts` - the ignore chain, the hard exclusions, symlink handling
- `src/scripts/detect-changes.ts` - the classification and the report it renders
- `tests/scripts/file-manifest.test.ts` - nested-ignore precedence, stated case by case
- `tests/scripts/detect-changes.test.ts` - the deleted/newly-ignored split

## Related Concepts

- [Script Registry](./script-registry.md)
- [Corpus Budget](./corpus-budget.md) — the source measurement runs over the same manifest
- [Project Configuration](./project-configuration.md)
- [Feature: Update Workflow](../features/update-workflow.md) — the consumer of a change set
