# Baseline and Change Detection

## Business Definition

The baseline and change detection system enables Saaga to perform incremental documentation updates. A **baseline** is a content manifest (`<docs_dir>/BASELINE`) that records the git hash of every tracked source file at documentation time. When the `update` workflow runs, the **change detection** script compares the current work tree against the baseline and classifies each difference so the agent knows exactly which files changed and why, enabling targeted documentation updates instead of full rewrites.

## Configuration

| Source | Description |
|--------|-------------|
| `<docs_dir>/BASELINE` | The generated content manifest file inside the documented application |
| `.saagaignore` | Optional gitignore-syntax file that excludes paths from documentation scope |
| `app_dir` (script arg) | The application directory |
| `output_dir` (script arg) | Directory where the changes report (`changes.md`) is written |
| `docs_dir` (script arg) | Name of the documentation directory (e.g. `"saaga-docs"`) |

**How to access:**
- `generateBaseline({ app_dir, docs_dir })` — creates or overwrites `<docs_dir>/BASELINE`
- `detectChanges({ app_dir, output_dir, docs_dir })` — reads `<docs_dir>/BASELINE`, computes diffs, writes `changes.md`

## Data Storage

### BASELINE File Format

The file is located at `<app_dir>/<docs_dir>/BASELINE` and has a plain-text format:

```
# Generated: <ISO 8601 timestamp>
<40-char git-blob-hash> <relative-path>
<40-char git-blob-hash> <relative-path>
...
```

**Header line** (prefixed with `#`) stores metadata:
- The `Generated` timestamp records when the baseline was created.

**Body lines** each contain a SHA-1 git blob hash (computed locally without git CLI) and the file's relative path, separated by a space. Files are sorted alphabetically.

### Exclusion Rules

Both `generateBaseline` and `detectChanges` use `computeManifest()` from `src/scripts/file-manifest.ts`, which excludes files using identical logic:

**Hard exclusions (regardless of ignore files):**
1. All paths under `<docsDir>/` are excluded (top-level only — documentation output, not source)
2. The `.git/` directory is excluded (top-level only)
3. Any file named `.saagaignore` at any depth is excluded

**Pattern-based exclusions with nested support:**
4. At each directory level, `.gitignore` and `.saagaignore` files are read and merged into a layer. The deepest layer that has an opinion (ignore or explicitly un-ignore) about a path determines the outcome ("deepest match wins" semantics).

Pattern matching uses the `ignore` npm package (gitignore-syntax). No git CLI is required.

### Change Classification

When comparing current state to the baseline, each difference is classified into exactly one category:

| Classification | Condition | Meaning |
|---------------|-----------|---------|
| **changed** | Path exists in both baseline and current, hashes differ | File content was modified |
| **new** | Path in current manifest but not in baseline | File is new to the scope (brand-new or newly unignored) |
| **truly_deleted** | Path in baseline but not current, file does not exist on disk | File was removed |
| **newly_ignored** | Path in baseline but not current, file still exists on disk | File still exists but is now excluded by `.saagaignore` or `.gitignore` |

### DetectChangesResult

| Field | Type | Purpose |
|-------|------|---------|
| `count` | `number` | Total number of detected changes (sum of all classifications) |
| `changes_path` | `string` | Absolute path to the generated `changes.md` report |
| `changed` | `number` | Count of files with modified content |
| `new` | `number` | Count of new-to-scope files |
| `truly_deleted` | `number` | Count of removed files |
| `newly_ignored` | `number` | Count of files now excluded from scope |

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Export | Purpose |
|--------|-----------------|---------|
| `src/scripts/generate-baseline.ts` | `generateBaseline()` | Writes `<docs_dir>/BASELINE` with header + sorted hash-path lines |
| `src/scripts/generate-baseline.ts` | `GenerateBaselineArgs` (interface) | `{ app_dir: string, docs_dir: string }` |
| `src/scripts/detect-changes.ts` | `detectChanges()` | Compares work tree against BASELINE, classifies differences, writes report |
| `src/scripts/detect-changes.ts` | `DetectChangesArgs` (interface) | `{ app_dir: string, output_dir: string, docs_dir: string }` |
| `src/scripts/detect-changes.ts` | `DetectChangesResult` (interface) | Return type with per-classification counts and report path |
| `src/scripts/file-manifest.ts` | `computeManifest()` | Walks `appDir`, applies `.gitignore`/`.saagaignore`, returns sorted `FileEntry[]`; accepts `(appDir, docsDir)` parameters |
| `src/scripts/file-manifest.ts` | `gitBlobHash()` | Computes a SHA-1 git blob hash from a `Buffer` (no git CLI needed) |
| `src/scripts/file-manifest.ts` | `fileExists()` | Checks whether a path exists as a regular file or symlink (uses `lstat`; returns `false` for directories) |
| `src/scripts/file-manifest.ts` | `FileEntry` (interface) | `{ hash: string; path: string }` |

## Internal Implementation

Both scripts share file-listing via `computeManifest()` from `src/scripts/file-manifest.ts`:

1. Recursively walk `appDir`. At each directory, read `.gitignore` and `.saagaignore` and push them as a layer onto an `IgnoreLayer` chain (shallow-to-deep)
2. For each entry, apply hard exclusions: skip `.git/` and `<docsDir>/` (top-level), and any file named `.saagaignore`
3. Evaluate the `IgnoreLayer` chain: the deepest layer that has an opinion determines whether the path is excluded ("deepest match wins")
4. For each surviving regular file or symlink, compute a SHA-1 git blob hash via `gitBlobHash()` (no git CLI). Regular files are hashed from their content; symlinks are hashed from their link target path string (git-style, never following the link). Symlinked directories are not traversed.
5. Return a sorted `FileEntry[]`

Change detection additionally uses:
- `extractHeaderValue()` — parses `# Key: value` lines from BASELINE header
- `parseBaselineBody()` — parses `<hash> <path>` body lines
- `fileExists()` — distinguishes truly deleted files from newly ignored ones; uses `lstat` so it returns `true` for symlinks and `false` for directories, matching manifest eligibility exactly
- `renderReport()` — generates the markdown changes report

## Reference Implementations

- `src/scripts/generate-baseline.ts` — the baseline writer; accepts `{ app_dir, docs_dir }` args
- `src/scripts/detect-changes.ts` — the change detection engine; accepts `{ app_dir, output_dir, docs_dir }` args
- `flows/init.flow.yaml` — invokes `generate-baseline` as the final step with `docs_dir: ${docs_dir}`
- `flows/update.flow.yaml` — invokes `detect-changes` as the first step with `docs_dir: ${docs_dir}`, then conditionally proceeds if `${changes.count} != 0`

## Related Concepts

- [Script Registry](./script-registry.md) — both scripts are registered in `defaultScriptRegistry`
- [Scope and Expressions](./scope-and-expressions.md) — the `DetectChangesResult` fields are accessed via `${changes.count}`, `${changes.changes_path}`, etc.
- [Flow DSL](./flow-dsl.md) — defines the `ScriptStep` type used to invoke these scripts
