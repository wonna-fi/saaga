# Using .saagaignore

## When to Use

Use a `.saagaignore` file when you want to exclude certain source files or directories from Saaga's documentation scope. This is useful for:

- Vendored dependencies that don't need domain documentation
- Build output that happens to be committed
- Generated files (lock files, compiled assets)
- Configuration files irrelevant to the application domain (CI configs, editor settings)

The `.saagaignore` file affects both **baseline generation** (which files get recorded) and **change detection** (which changes trigger documentation updates).

## Pattern

Create a `.saagaignore` file in the root of the application being documented. The syntax follows gitignore conventions (processed by the `ignore` npm package):

```gitignore
# Exclude vendored dependencies
vendor/

# Exclude build output
build/
dist/

# Exclude lock files
pnpm-lock.yaml
package-lock.json

# Exclude CI and editor configuration
.github/
.vscode/

# Exclude specific file types
*.min.js
*.map
```

### How It Works

Both `generate-baseline` and `detect-changes` apply ignore rules using `computeManifest()` from `src/scripts/file-manifest.ts` — a pure Node.js walk with no git CLI dependency:

1. Walk the application directory recursively. At each directory, read `.gitignore` and `.saagaignore` (if present) and merge them into an `IgnoreLayer`.
2. Apply hard exclusions first: skip `docs/` and `.git/` (top-level only), and any file named `.saagaignore` at any depth.
3. Evaluate the `IgnoreLayer` chain shallow-to-deep. The deepest layer that has an opinion (ignore or explicitly un-ignore) about a path determines the outcome ("deepest match wins" semantics).
4. For surviving files, compute a SHA-1 git blob hash locally via `gitBlobHash()`.

This means nested `.saagaignore` files inside subdirectories are honoured — a `.saagaignore` in `src/vendor/` can exclude files under that subtree without affecting files elsewhere.

### Effect on Change Detection

When `.saagaignore` patterns change between baseline generation and change detection, the system correctly classifies the resulting differences:

| Scenario | Classification |
|----------|---------------|
| A file was included at baseline time, `.saagaignore` is tightened, file is now excluded | **newly_ignored** |
| A file was ignored at baseline time, `.saagaignore` is relaxed, file is now visible | **new** |
| A new file is added that is not matched by `.saagaignore` | **new** |
| An included file is deleted from disk | **truly_deleted** |

This means adjusting `.saagaignore` will correctly trigger documentation updates for the affected files rather than silently ignoring them.

## Key Points

- A `.saagaignore` at the root of the application directory applies globally; nested `.saagaignore` files inside subdirectories apply to their subtree only
- Uses gitignore syntax — directory patterns need a trailing `/` (e.g., `vendor/`)
- Any file named `.saagaignore` (at any depth) is always excluded from the baseline (it's documentation configuration, not source)
- The `docs/` directory is always excluded regardless of `.saagaignore` (documentation output is never baselined)
- Patterns are evaluated by the `ignore` npm package — glob syntax (`*.min.js`), negation (`!important.js`), and directory matching all work as expected
- Changes to `.saagaignore` between runs are reflected as `newly_ignored` or `new` classifications in the change report

## Reference Implementations

| File | Function | Notes |
|------|----------|-------|
| `src/scripts/file-manifest.ts` | `computeManifest()` | Core walk + ignore logic shared by both scripts |
| `src/scripts/generate-baseline.ts` | `generateBaseline()` | Delegates to `computeManifest()` to produce the hashed file list |
| `src/scripts/detect-changes.ts` | `detectChanges()` | Delegates to `computeManifest()` to compute the current work tree state |

## Anti-Patterns

**Do NOT:**

- Put `docs/` in `.saagaignore` — it is already hardcoded as excluded; adding it is redundant
- Ignore files that are part of the application's domain logic — `.saagaignore` should only exclude files that are irrelevant to understanding the application
- Forget the trailing `/` on directory patterns — `vendor` only matches a file named `vendor`, while `vendor/` matches the directory and all its contents
