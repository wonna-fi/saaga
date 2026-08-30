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
- `{docs_dir}/conventions/INDEX.md` (if it exists)
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
5. Preserve the YAML frontmatter block exactly as it is, with one exception: if
   your edit makes the document cover a source file that `sources` does not list
   yet, add that path. **Never touch `last_verified`** — a quick update is not a
   verification, so bumping it would hide a stale document from the next
   staleness sweep. A document without frontmatter is a pre-beta document; leave
   it without one.

### For new documentation:

Start every new file with a YAML frontmatter block, then follow these structural
conventions:

```markdown
---
title: {Document Title}
type: {concept|pattern|convention|feature}
sources:
  - {source path or glob this document describes}
---
```

`title` matches the `#` heading; `type` matches the directory the file goes in;
`sources` lists the paths whose behaviour the document describes. Do not write
`last_verified` — only a verification pass sets that field.


- **Concepts** → `{docs_dir}/concepts/{name}.md`: Business Definition, Configuration (optional), Data Storage (optional), Key Services/Functions, Reference Implementations, Related Concepts. Omit an inapplicable optional section outright; never stub it. A concept does not narrate process — link to the feature that does.
- **Patterns** → `{docs_dir}/patterns/{name}.md`: When to Use, Pattern (code example), Key Points, Reference Implementations, Anti-Patterns
- **Conventions** → `{docs_dir}/conventions/{family}.md`: the rule, one conforming example, one counter-example, where it applies. One file per convention *family*, 5–20 lines of body, and no `sources` in the frontmatter. A rule that requires reading code flow is a **pattern**. A rule you could check with grep is a **convention**.
- **Features** → `{docs_dir}/features/{name}.md`: Overview, Key Concepts, Functional Specification (User Flow *or* Mechanism — Mechanism when the system rather than a person is the actor — plus Validation Rules, Edge Cases), Technical Implementation, Integration Points, Extension Guide

### For deletions/ignored files:

- Remove or trim documentation sections that reference only deleted/ignored files
- Remove entries from INDEX.md files

### INDEX files:

After all edits, update `{docs_dir}/concepts/INDEX.md`, `{docs_dir}/patterns/INDEX.md`, `{docs_dir}/features/INDEX.md`, and `{docs_dir}/conventions/INDEX.md` (if the category exists) to reflect any added or removed documents.

### Quality guardrails:

- Base every claim on evidence from the source code. If you cannot find evidence, do not document it as fact.
- Only list public/exported functions in Key Services/Functions tables.
- Verify that referenced files, functions, and components actually exist.
- Keep edits minimal and targeted — do not rewrite entire documents when a surgical edit suffices.
- **Diff budget.** Count the changed source files. With fewer than ~5, correct as many documents as are actually wrong — there is **no limit on corrections** — but at most **one or two** may get *longer*, and create **no** new document unless the change introduces a genuinely new concept.
- **Amortize.** Fold a small change into an existing table row or an existing sentence. Do not open a new section for it.
- **Apply the consequence test** before documenting any internal mechanism. See Level of Detail below. A quick update has no plan, so no document has an assigned line budget here — but do not push a document past its tier's band, and say so in the summary if one is already past it.

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

{include:partials/lod-policy.md}

---

## Notes

- Speed over perfection. This update will be verified and hardened later by `verify-quick-updates`.
- When in doubt about a change's documentation impact, document it — briefly. Err toward coverage, never toward length (flag uncertainty in the summary).
- Do NOT regenerate `{docs_dir}/BASELINE` — that is handled by the tool after this session.
- Do NOT use any IDE-specific tools (like CreatePlan). Write files directly.
- Do NOT modify repository source code or create git commits.
- Read-only git history is available when the project is a git repository. You may use `git log`, `git show`, `git diff`, `git blame`, and similar read-only commands to understand changes, recover intent, and verify documentation claims. Do not run any git commands that modify the repository.
