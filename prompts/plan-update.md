# Update Domain Documentation for an Application

**Input**: The application to document is at the project root (`.`). The application name is `{app}`. A pre-computed changes report is available at `{changes_path}`.

**Goal**: Analyze source code changes (from the changes report) and produce a documentation update plan. Write the plan to `{output_path}`. This command handles **incremental updates** to existing documentation.

---

## Step 1: Validate Prerequisites

### 1a. Read the Changes Report

Read the changes report at `{changes_path}`. It contains:

- **Changed files**: Files that exist in both the BASELINE and current state but have different content
- **New files**: Files added to the codebase since the BASELINE was created (includes files that were previously excluded via `.saagaignore` and are now back in scope)
- **Deleted files**: Files that were in the BASELINE but have been removed from the codebase entirely
- **Newly Ignored files**: Files that still exist in the codebase but are now excluded from documentation scope via `.saagaignore` — remove or trim documentation that references these files

If the changes report shows no changes, stop and report that documentation is up to date.

### 1c. Triage Decision

Before proceeding, judge whether the detected changes substantively affect documented surfaces. Document-worthy changes typically include:

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

If, after analyzing the changes against the existing documentation, you conclude that no documented surface is affected, write a plan with `phases: []` and a clear `## Decision` section in the body explaining the rationale (cite the changed files and why each is non-doc-worthy). Skip Steps 2 onward.

If even one change is doc-worthy, proceed normally.

### 1b. Verify Documentation Structure

Verify that all three INDEX files exist:

- `{docs_dir}/concepts/INDEX.md`
- `{docs_dir}/patterns/INDEX.md`
- `{docs_dir}/features/INDEX.md`

If any are missing, note it in the plan as a prerequisite issue.

### 1c. Check Documentation Scope

If a `.saagaignore` file exists at the project root, it defines paths and patterns (using gitignore syntax) that are excluded from documentation scope. Any documentation that covers only ignored areas should be planned for removal. Do not plan new documentation for ignored paths.

---

## Step 2: Analyze Changes

### 2a. Cross-Reference Against Existing Documentation

Read the existing documentation to understand what is already covered:

- `{docs_dir}/concepts/INDEX.md`
- `{docs_dir}/patterns/INDEX.md`
- `{docs_dir}/features/INDEX.md`
- `{docs_dir}/ARCHITECTURE.md`

For each file from the changes report, determine:

- Does it relate to an already-documented domain area? If so, which documents?
- Does it represent entirely new functionality that no existing docs cover?
- For deleted files: do any existing docs reference the deleted file?
- For newly ignored files: do any existing docs cover the ignored area? Those docs should be removed or trimmed.

### 2b. Deep Impact Analysis for Existing Docs

For each existing document identified as potentially affected:

1. Read the existing documentation file
2. Read the current source code of the changed files directly
3. Produce **specific** update suggestions, e.g.:
   - "New method `applyBulkDiscount()` added to `PurchaseService` -- add to Key Services table in `card-purchase.md`"
   - "Validation rule for minimum age changed from 7 to 6 -- update Validation Rules in `card-purchase.md`"
   - "New error handling branch added -- update Edge Cases table in `visit-marking.md`"
   - "File `OldHelper.cls` deleted -- remove references from `card-validity.md`"
   - "Module `LegacySync` newly ignored -- delete `legacy-sync.md` concept doc and remove from INDEX"

### 2c. Group Related Changes

Analyze all file lists (changed, new, deleted, newly ignored) to group related changes into logical phases. Multiple files touching the same domain area or implementing parts of the same feature should be grouped together.

Group by directory or module proximity.

Order groups by directory structure.

Only create ONE phase per change. Refer to commit history to understand what is ONE change. Creating unnecessarily
granular phases will slow the update process drastically. We want to keep it fast.

---

## Step 3: Adapt Templates to the Technology

Based on the application's technology stack (read from config files or existing documentation), determine:

{include:partials/adapt-templates-to-technology.md}

---

## Step 4: Write the Plan

Write the plan to `{output_path}`. The plan MUST follow the exact format specified below.

### Plan File Format

The plan file uses YAML frontmatter for machine parsing followed by rich markdown content. The YAML frontmatter MUST contain a `phases` array that lists every phase with its number and title. This array is parsed by automation to determine how many phases to execute.

Example structure:

```yaml
---
app: {app}
type: update
generated: 2026-04-13T14:30:00+03:00
phases:
  - number: 1
    title: "New Feature X Documentation"
  - number: 2
    title: "Update Card Purchase Docs"
  - number: 3
    title: "Update ARCHITECTURE.md"
---
```

**CRITICAL**: The `phases` array in the frontmatter MUST list every phase defined in the plan body. Phase numbers in the frontmatter MUST match `## Phase N:` headings in the markdown body.

**Note:** If the triage in Step 1c concluded no doc-worthy changes, `phases` MUST be an empty array (`phases: []`) and the plan body MUST contain a `## Decision` section explaining why each detected change was deemed non-doc-worthy. Sections 1-13 are not required in that case.

### Plan Body Sections

The markdown body MUST contain the following sections:

#### 1. Change Summary

A categorized list of all changes detected since the BASELINE, organized into logical groups. For each group:

- Changed, new, and deleted files
- Commit messages (where available from the changes report)
- Classification: "New documentation needed" or "Update to existing documentation"

#### 2. Approach

Include this mermaid diagram showing the vertical slice structure:

```
flowchart LR
    subgraph slice [Vertical Slice]
        C[Concepts] --> P[Patterns]
        P --> F[Features]
    end

    C -.-> |references| Code[(Source Code)]
    P -.-> |examples from| Code
    F -.-> |links to| C
    F -.-> |links to| P
```

Add a note that slices are flexible -- not all three doc types (concept, pattern, feature) are required for every phase. Only create what is warranted by the changes.

#### 3. Documentation Templates

Include three templates (Concept, Pattern, Feature) adapted from the universal templates in the Reference section below. Adapt code examples, file references, and terminology to match the application's language and framework conventions.

Each template MUST include an example based on an actual domain area from the application to illustrate the expected format and level of detail.

#### 4. Decision Guidance

Include verbatim from the Reference section below.

#### 5. Quality Checklists

Adapt the universal checklists from the Reference section, adding technology-specific verification steps from Step 3.

#### 6. Handling Uncertainty

Include verbatim from the Reference section below.

#### 7. Verification Requirements

**Golden Rule: If you cannot find evidence for a claim in the source code, do NOT document it as fact.**

Include a technology-specific verification summary table:

| What to Verify | How to Verify | Common Mistakes |
|---|---|---|
| (technology-specific rows) | | |

Also include an **Internal Consistency Check** requirement: after completing all documents in a phase, cross-reference behavior descriptions across concept, pattern, and feature docs. Verify claims don't contradict each other and update conflicting documents to be consistent with the actual code behavior.

#### 8. Mandatory Verification Protocol

A step-by-step protocol that MUST be executed before marking any document as complete. Create a technology-adapted version with these steps:

**Step 1: Key Services/Functions Verification** - For EVERY function/method listed in a "Key Services/Functions" table, search the source file and verify it is part of the public API. If not public/exported, remove it from the table and add it to an "Internal Implementation" note instead.

**Step 2: Reference Implementation Verification** - For EVERY function listed in "Reference Implementations", verify it exists and check its accessibility. Public functions are listed by name; internal functions are referenced by file name with a note.

**Step 3: Document Review Checklist** - A final self-check confirming: every function name was searched in source, accessibility was verified for each, all public API items are correctly listed, and internal functions are properly noted.

Adapt the specific verification commands to the technology (e.g., `Grep: "export.*functionName"` for TypeScript, `Grep: "public.*methodName"` for Apex/Java).

Include these final self-check questions:

1. Can you point to the exact line of code for every claim?
2. Have you actually read the source file (not just searched)?
3. Have you verified example outputs match actual behavior?

#### 9. Lessons Learned

Include an empty "Lessons Learned" section. It will be populated during execution as issues are discovered in reviews. Each entry format:

- **Problem**: What went wrong
- **Root Cause**: Why it happened
- **Corrective Actions**: What was fixed
- **Prevention**: How to avoid it in future slices

#### 10. New Documentation Phases (Phase 1 through Phase N)

For each group of changes requiring **new** documentation (in chronological order):

- **Summary**: What was changed/added (commit messages and description)
- **Concepts to document**: List concepts (if warranted)
- **Patterns to document**: List patterns (if warranted)
- **Features to document**: List features (if warranted)
- **Key files to analyze**: Specific source files changed

Not all three doc types are required for every phase -- only include what is warranted by the changes.

#### 11. Update Existing Documentation Phases (Phase N+1 through Phase M)

For each group of changes affecting **existing** documentation (in chronological order):

- **Summary**: What was changed (commit messages and description)
- **Documents to update**: List specific doc files with specific update suggestions (from the deep impact analysis in Step 2b)
- **Key files to analyze**: The changed source files

#### 12. ARCHITECTURE.md Update Phase (conditional)

Only included if significant structural changes are detected (new services, new integrations, new modules, new directories). Lists what sections of ARCHITECTURE.md need updating and why.

If no structural changes are detected, omit this section entirely.

#### 13. Execution Strategy

- New documentation phases execute first (later update phases may reference them)
- Within each phase: concepts first, then patterns, then features
- For update phases: read existing doc, apply changes, verify consistency
- Cross-link between docs; update INDEX.md files after each phase
- Run the Mandatory Verification Protocol on all documents before marking complete
- Reviews after each phase; findings go in Lessons Learned

{include:partials/index-format.md}

#### 14. Success Criteria

- All changes since the BASELINE are reflected in documentation
- New concepts/patterns/features have complete docs following templates
- Updated docs accurately reflect the current code behavior
- INDEX.md files are up to date
- No contradictions between updated and existing docs (internal consistency check)
- ARCHITECTURE.md reflects any structural changes

---

## Reference: Universal Methodology

{include:partials/document-templates.md}

---

{include:partials/decision-guidance.md}

---

{include:partials/handling-uncertainty.md}

---

{include:partials/quality-checklists.md}

---

## Notes

- The BASELINE file is NOT regenerated by this plan. BASELINE regeneration is managed by the tool after all phases complete.
- Do NOT author or edit agent rule files (`AGENTS.md`, `CLAUDE.md`, Cursor `.mdc`, Copilot instructions); the documentation guidance written into them is managed separately by the `install-rules` step, not by this plan.
- If the application has an existing `{docs_dir}/ARCHITECTURE.md`, use it to understand the current documented structure and identify structural changes.
- Write the plan to `{output_path}`. Do NOT use any IDE-specific tools (like CreatePlan). Write the file directly.
- Do NOT modify repository source code or create git commits.
- Read-only git history is available when the project is a git repository. You may use `git log`, `git show`, `git diff`, `git blame`, and similar read-only commands to understand the nature and intent of changes. Do not run any git commands that modify the repository.
