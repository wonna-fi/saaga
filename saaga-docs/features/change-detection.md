# Feature: Change Detection

## Overview

The change detection feature compares the current state of an application's source files against a previously generated `<docs_dir>/BASELINE` manifest. It classifies every difference into one of four categories (changed, new, truly deleted, newly ignored), writes a markdown report, and returns structured counts so the flow engine can decide whether documentation updates are needed.

## Key Concepts

Before working with this feature, understand these concepts:
- [Baseline and Change Detection](../concepts/baseline-and-change-detection.md) — the BASELINE file format, `.saagaignore` filtering, and change classification definitions
- [Script Registry](../concepts/script-registry.md) — `detect-changes` is a registered built-in script
- [Scope and Expressions](../concepts/scope-and-expressions.md) — the result fields are accessed via `${changes.count}`, `${changes.changes_path}`, etc.

## Functional Specification

### User Flow

1. User runs `saaga update <dir>` on an application that already has `<docs_dir>/BASELINE`
2. The update flow invokes `detect-changes` as its first step
3. The script reads `<docs_dir>/BASELINE` to get the previous file manifest
4. It computes the current manifest via `computeManifest()` from `file-manifest.ts` — a pure Node.js walk that applies `.gitignore` and `.saagaignore` filtering without invoking git
5. It compares the two manifests and classifies every difference
6. For files absent from the current manifest but present in the baseline, it calls `fileExists()` to determine whether the file is truly deleted (absent on disk) or newly ignored (still on disk but excluded by ignore rules)
7. It writes a markdown report to `<output_dir>/changes.md`
8. It returns a `DetectChangesResult` stored in scope (e.g., `set: changes`)
9. The flow uses `${changes.count}` in an `if` condition to skip documentation updates when there are no changes

### Change Report Format

The report written to `<output_dir>/changes.md` follows this structure:

```markdown
# Changes Since BASELINE

**App**: <app directory basename>
**BASELINE date**: <ISO timestamp from baseline header>
**Summary**: N changed, N new, N deleted, N ignored

## Changed Files

- `path/to/modified-file.ts`

## New Files

- `path/to/brand-new-file.ts`

## Deleted Files

_None_

## Newly Ignored Files

_None_
```

Each section lists paths as inline code items, or `_None_` if the category has zero entries.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| `app_dir` arg is missing | Throws `Error: detect-changes: 'app_dir' arg is required` |
| `output_dir` arg is missing | Throws `Error: detect-changes: 'output_dir' arg is required` |
| `app_dir` does not exist or is not a directory | Throws `Error: detect-changes: directory not found: <app_dir>` |
| `docs_dir` arg is missing | Throws `Error: detect-changes: 'docs_dir' arg is required` |
| `<docs_dir>/BASELINE` file does not exist | Throws `Error: detect-changes: BASELINE file not found at <path>. Run 'init' first to create initial documentation and baseline.` |
| No changes detected | Returns `{ count: 0, ... }` with a report showing all zeros — flow uses `if: '${changes.count} != 0'` to skip |
| `.saagaignore` patterns changed since baseline | Affected files are classified as `newly_ignored` (removed from scope) or `new` (added to scope) |
| `output_dir` does not exist | Created automatically via `mkdir({ recursive: true })` |
| `.saagaignore` or `.gitignore` does not exist | Pattern file is silently skipped; no filtering applied for that file |
| Symlinks in `app_dir` | Included in manifest and hashed git-style (link target path, not linked content); broken symlinks are included; symlinked directories are not traversed |

## Technical Implementation

### Script Registration

Registered as `"detect-changes"` in `defaultScriptRegistry` (`src/scripts/registry.ts`).

### Flow YAML Usage

```yaml
- script:
    name: detect-changes
    app_dir: ${app_path}
    output_dir: ${run_dir}
    docs_dir: ${docs_dir}
    set: changes

- if: '${changes.count} != 0'
  then:
    # ... proceed with documentation update
```

### Services/Functions

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/scripts/detect-changes.ts` | `detectChanges()` | Main handler: compares work tree against BASELINE, writes report, returns counts |
| `src/scripts/file-manifest.ts` | `computeManifest()` | Walks `appDir`, applies nested `.gitignore`/`.saagaignore` with deepest-match-wins semantics, excludes `<docsDir>/`; accepts `(appDir, docsDir)` parameters; handles symlinks git-style; returns sorted `FileEntry[]` |
| `src/scripts/file-manifest.ts` | `fileExists()` | Checks whether a path exists as a regular file or symlink (uses `lstat`; returns `false` for directories — used to distinguish deleted vs. newly ignored) |
| `src/scripts/registry.ts` | `defaultScriptRegistry` | Registers `"detect-changes"` → `detectChanges` |

### Internal Implementation

| Function | Purpose |
|----------|---------|
| `extractHeaderValue()` in `src/scripts/detect-changes.ts` | Parses `# Key: value` lines from BASELINE header using regex |
| `parseBaselineBody()` in `src/scripts/detect-changes.ts` | Parses `<hash> <path>` body lines into `FileEntry[]` |
| `renderReport()` in `src/scripts/detect-changes.ts` | Generates the markdown changes report from classification results |

### Classification Algorithm

1. **Build maps**: Create `Map<path, hash>` for both baseline and current manifests via `computeManifest()`
2. **Find new and changed**: For each path in the current map, check if it exists in the baseline map. If missing → `new`. If hash differs → `changed`.
3. **Find deleted**: For each path in the baseline map, check if it exists in the current map. If missing → deleted candidate.
4. **Refine deleted paths**: For each deleted candidate, call `fileExists()`. If file exists on disk → `newly_ignored`. If absent → `truly_deleted`.

### Return Value

Returns `DetectChangesResult`:

| Field | Type | Scope Access |
|-------|------|-------------|
| `count` | `number` | `${changes.count}` |
| `changes_path` | `string` | `${changes.changes_path}` |
| `changed` | `number` | `${changes.changed}` |
| `new` | `number` | `${changes.new}` |
| `truly_deleted` | `number` | `${changes.truly_deleted}` |
| `newly_ignored` | `number` | `${changes.newly_ignored}` |

## Integration Points

- **Depends on**: `<docs_dir>/BASELINE` (must exist — created by `generate-baseline`), `src/scripts/file-manifest.ts` for manifest computation, Node.js `fs/promises` for file I/O
- **Used by**: `flows/update.flow.yaml` and `flows/quick-update.flow.yaml` as the first step, gating whether the update proceeds
- **Produces data for**: The `plan-update` prompt template (via `${changes.changes_path}`), flow `if` conditions (via `${changes.count}`)

## Extension Guide

To add a new change classification:
1. Add the classification logic in `detectChanges()` in `src/scripts/detect-changes.ts`
2. Add the count field to `DetectChangesResult` interface
3. Include the count in the `total` calculation
4. Add a new section in `renderReport()` for the classification
5. The new field will automatically be accessible in flow scope via `${changes.new_field}`
