# Feature: Baseline Generation

## Overview

The baseline generation feature creates a content manifest (`docs/BASELINE`) for an application's source files. This manifest records a SHA-1 git blob hash of every in-scope file, along with a timestamp of when it was generated. It serves as the reference point for future change detection, enabling the `update` workflow to identify exactly which files changed since documentation was last written. No git CLI is required — hashes are computed locally.

## Key Concepts

Before working with this feature, understand these concepts:
- [Baseline and Change Detection](../concepts/baseline-and-change-detection.md) — the BASELINE file format and exclusion rules
- [Script Registry](../concepts/script-registry.md) — `generate-baseline` is a registered built-in script

## Functional Specification

### User Flow

1. The `init` workflow runs all documentation phases
2. As the final step, the flow invokes `generate-baseline` with the application directory
3. The script ensures `docs/` exists (creates it if needed)
4. It calls `computeManifest()` from `file-manifest.ts`, which recursively walks the directory, applying `.gitignore` and `.saagaignore` exclusion rules, and computes a SHA-1 git blob hash for each in-scope file
5. It writes the `docs/BASELINE` file with a `# Generated:` header and sorted hash-path body lines

### Output Format

```
# Generated: 2026-05-16T10:53:03.000Z
<40-char-hash> README.md
<40-char-hash> src/bar.ts
<40-char-hash> src/foo.ts
```

Header line:
- `# Generated:` — ISO 8601 timestamp of when the baseline was created

Body lines are sorted alphabetically by path. Each line contains the 40-character SHA-1 git blob hash (computed locally via `gitBlobHash()`) followed by a space and the file's relative path.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| `app_dir` arg is missing or empty | Throws `Error: generate-baseline: 'app_dir' arg is required` |
| `docs/` directory does not exist | Created automatically via `mkdir({ recursive: true })` |
| No files remain in scope after filtering | Writes the header line only (no body lines) |
| `.saagaignore` does not exist | No `.saagaignore` pattern filtering applied; only `.gitignore` and hardcoded exclusions (`docs/`, `.git/`) |
| `.saagaignore` exists with patterns | Matching files are excluded from the baseline |
| `docs/BASELINE` already exists | Overwritten with the new content |
| Symlinks in `app_dir` | Included as manifest entries and hashed git-style (hash of the link target path string, not the linked file's content); symlinked directories are not traversed |

## Technical Implementation

### Script Registration

Registered as `"generate-baseline"` in `defaultScriptRegistry` (`src/scripts/registry.ts`).

### Flow YAML Usage

In `flows/init.flow.yaml` (final step), `flows/update.flow.yaml` (final step within the changes-exist branch), and `flows/quick-update.flow.yaml` (final step after archiving):

```yaml
- script:
    name: generate-baseline
    app_dir: ${app_path}
```

The script does not use `set:` because it returns `void` — its purpose is the side effect of writing the BASELINE file.

### Services/Functions

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/scripts/generate-baseline.ts` | `generateBaseline()` | Main handler: computes manifest and writes `docs/BASELINE` |
| `src/scripts/file-manifest.ts` | `computeManifest()` | Walks `appDir`, applies `.gitignore`/`.saagaignore`, returns sorted `FileEntry[]` |
| `src/scripts/registry.ts` | `defaultScriptRegistry` | Registers `"generate-baseline"` → `generateBaseline` |

### Internal Implementation

`generateBaseline()` calls `computeManifest(appDir)` and writes a `# Generated: <timestamp>` header followed by one `<hash> <path>` line per `FileEntry`. No external processes are spawned.

## Integration Points

- **Depends on**: `src/scripts/file-manifest.ts` for manifest computation, `node:fs/promises` for file I/O
- **Used by**: `flows/init.flow.yaml` (final step after all documentation is written), `flows/update.flow.yaml` (final step after documentation updates), `flows/quick-update.flow.yaml` (final step after archiving the quick-update artifact)
- **Consumed by**: `detect-changes` script (reads `docs/BASELINE` as the reference point for change detection)

## Extension Guide

To add metadata to the baseline:
1. Add a new `# Key: value` header line in the `lines` array in `generateBaseline()` in `src/scripts/generate-baseline.ts`
2. To consume the new header in change detection, add an `extractHeaderValue()` call in `detectChanges()` in `src/scripts/detect-changes.ts`
