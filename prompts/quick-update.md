# Quick-Update Domain Documentation

**Input**: The application to document is at the project root (`.`). The application name is `{app}`. A pre-computed changes report is available at `{changes_path}`.

**Output artifacts**:

- Status file at `{status_path}` — write exactly `UPDATED` or `SKIPPED` (nothing else).
- If UPDATED: summary file at `{summary_path}` — structured metadata about the quick update.
- If UPDATED: modified/created documentation files under `{docs_dir}/`.

**Goal**: Perform a fast, single-session documentation update. Triage changes, update affected docs directly, do a light self-verification pass, and record what you did. Speed is the priority — this does not need to be perfect; a later `verify-quick-updates` run will harden the results.

---

## Step 1: Read the Changes Report

Read the changes report at `{changes_path}`. It contains:

- **Changed files**: Modified since BASELINE
- **New files**: Added to the codebase since BASELINE (includes files previously excluded via `.saagaignore` that are now in scope)
- **Deleted files**: Removed from the codebase
- **Newly Ignored files**: Now excluded by `.saagaignore` — trim/remove docs referencing only these

## Step 2: Triage

Judge whether the detected changes substantively affect documented surfaces. Document-worthy changes typically include:

- New or removed public APIs, services, exported functions, classes, or modules
- New features, screens, or user-facing flows
- Changes to data models, validation rules, or business logic
- Changes to integration points, configuration sources, or environment-driven behavior
- Architectural shifts (new directories, new external dependencies, restructured layers)

Changes that are **not** document-worthy include (non-exhaustive):

- Pure styling changes (`*.css`, `*.scss`, theme tokens with no behavior impact)
- Asset-only changes (icons, images, fonts)
- Test-only changes (`*.test.*`, `*.spec.*`, snapshot updates)
- Auto-generated lockfiles
- Whitespace, comment-only, or formatting-only edits
- Internal refactors that preserve all public APIs and behavior

If no change is document-worthy, write `SKIPPED` to `{status_path}` and stop. Do not create the summary file.

## Step 3: Read Existing Documentation

Read the documentation structure to understand what exists:

- `{docs_dir}/concepts/INDEX.md`
- `{docs_dir}/patterns/INDEX.md`
- `{docs_dir}/features/INDEX.md`
- `{docs_dir}/ARCHITECTURE.md` (if it exists)

For each doc-worthy change, determine:

- Does it affect an already-documented area? Which documents?
- Does it require entirely new documentation?
- For deleted/ignored files: do existing docs reference them?

## Step 4: Update Documentation

For each affected area, read the relevant source code and update the documentation directly:

### For existing documents that need updates:

1. Read the existing document
2. Read the changed source code
3. Apply targeted edits: update tables, add/remove entries, fix descriptions
4. Preserve the existing document structure

### For new documentation:

Create new files following these structural conventions:

- **Concepts** → `{docs_dir}/concepts/{name}.md`: Business Definition, Configuration, Data Storage, Key Services/Functions, Reference Implementations, Related Concepts
- **Patterns** → `{docs_dir}/patterns/{name}.md`: When to Use, Pattern (code example), Key Points, Reference Implementations, Anti-Patterns
- **Features** → `{docs_dir}/features/{name}.md`: Overview, Key Concepts, Functional Specification (User Flow, Validation Rules, Edge Cases), Technical Implementation, Integration Points, Extension Guide

### For deletions/ignored files:

- Remove or trim documentation sections that reference only deleted/ignored files
- Remove entries from INDEX.md files

### INDEX files:

After all edits, update `{docs_dir}/concepts/INDEX.md`, `{docs_dir}/patterns/INDEX.md`, and `{docs_dir}/features/INDEX.md` to reflect any added or removed documents.

### Quality guardrails:

- Base every claim on evidence from the source code. If you cannot find evidence, do not document it as fact.
- Only list public/exported functions in Key Services/Functions tables.
- Verify that referenced files, functions, and components actually exist.
- Keep edits minimal and targeted — do not rewrite entire documents when a surgical edit suffices.

## Step 5: Light Self-Verification

After making all edits, do a quick review pass:

1. For each document you modified, re-read it and spot-check 2-3 factual claims against the source code.
2. For new documents, verify the Key Services/Functions table entries are public/exported.
3. Check that cross-references (links to other docs) point to files that exist.

If you find errors during self-verification, fix them immediately.

## Step 6: Write Summary

Write the summary file to `{summary_path}`. Format:

```yaml
---
generated: <ISO 8601 timestamp>
verified: false
docs_touched:
  - <relative path to each doc file created or modified>
confidence: <high|medium|low>
---
```

After the frontmatter, write a prose section covering:

- **What changed**: Brief summary of the code changes and their documentation impact.
- **What was updated**: List of documentation edits made, with a one-line description of each.
- **Uncertainty areas** (if any): Flag specific sections or claims where you had low confidence, so `verify-quick-updates` can focus attention there. Be specific — name the document, section, and what is uncertain.

## Step 7: Write Status

Write exactly `UPDATED` to `{status_path}`. Nothing else in this file.

---

## Notes

- Speed over perfection. This update will be verified and hardened later by `verify-quick-updates`.
- When in doubt about a change's documentation impact, err on the side of documenting it (flag uncertainty in the summary).
- Do NOT regenerate `{docs_dir}/BASELINE` — that is handled by the tool after this session.
- Do NOT use any IDE-specific tools (like CreatePlan). Write files directly.
