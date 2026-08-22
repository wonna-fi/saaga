# Plan Verification of Quick Updates

**Input**: The application to document is at the project root (`.`). The application name is `{app}`. A manifest of unverified quick-update metadata folders is at `{manifest_path}`. The metadata folders live under `{metadata_dir}`.

**Goal**: Read all unverified quick-update metadata artifacts, consolidate them into a verification plan, and write the plan to `{output_path}`. Each phase in the plan will be executed by an agent that re-documents the affected slice with full verification, bringing it to the same quality standard as the `update` command.

---

## Step 1: Read the Manifest

Read the manifest at `{manifest_path}`. It is a JSON file listing the quick-update IDs (folder names under `{metadata_dir}`).

For each ID, read:

1. `{metadata_dir}/<id>/changes.md` — the detect-changes report from the original quick-update run
2. `{metadata_dir}/<id>/summary.md` — the quick-update agent's self-report (YAML frontmatter + prose)

## Step 2: Analyze Quick Updates

For each quick-update artifact:

1. From `changes.md`: understand what source code changed
2. From `summary.md`: understand what documentation was modified, what the confidence level was, and what uncertainty areas were flagged
3. Read the current state of the documentation files listed in `docs_touched` to understand what exists now

### Gap detection (changed-but-undocumented surfaces)

The quick-update ran with a cheaper model under time pressure and may have **silently missed** a change that warrants documentation. `summary.md` only records what the quick-update agent was *aware* of — it cannot reveal an outright oversight. You MUST therefore reconcile what changed against what was documented:

1. From `changes.md`, enumerate the documentation-worthy changes: new/changed public APIs, exported functions/classes/modules, new features or user-facing flows, data-model or validation changes, integration/configuration changes, and architectural shifts. Ignore non-doc-worthy noise (pure styling, assets, tests, lockfiles, whitespace/comment-only edits, internal refactors that preserve public behavior).
2. Compare that list against `docs_touched` and the current documentation. Any doc-worthy change that has **no corresponding documentation** is a **coverage gap**.
3. Record each coverage gap (the source surface, and the concept/pattern/feature doc that should exist for it). These gaps MUST be scoped into the artifact's phase so the slice re-documentation step creates the missing documentation — not just verifies existing docs.

## Step 3: Consolidation

Group the quick updates into phases following these rules:

- **Every quick-update artifact in the manifest MUST be covered by exactly one phase.** Never drop an artifact, and never split a single quick-update across multiple phases. Each artifact represents a real documentation change (the quick-update only produced an artifact when it reported `UPDATED`), so each one warrants a phase even if its summary claims high confidence. After building the phase list, confirm that the union of all phases' artifact IDs equals the full set of IDs in the manifest.
- **Small, related quick-updates SHOULD be consolidated into one phase.** Quick updates are related when they touch overlapping documentation files or cover the same domain area. Consolidating is desirable — it reduces redundant verification work.
- **Order phases** so that foundational documentation (concepts) is verified before documentation that depends on it (patterns, features).

For each phase, identify:

- Which quick-update artifact(s) it consolidates
- Which documentation files need verification
- **Which coverage gaps must be closed** — doc-worthy changes from the gap detection in Step 2 that have no documentation yet and must be newly created in this phase
- What the uncertainty areas are (from the summary files)
- Which source files to analyze

## Step 4: Verify Documentation Structure

Verify that all three INDEX files exist:

- `{docs_dir}/concepts/INDEX.md`
- `{docs_dir}/patterns/INDEX.md`
- `{docs_dir}/features/INDEX.md`

If any are missing, note it in the plan as a prerequisite issue.

## Step 5: Adapt Templates to the Technology

Based on the application's technology stack (read from config files or existing documentation), determine:

{include:partials/adapt-templates-to-technology.md}

## Step 6: Write the Plan

Write the plan to `{output_path}`. The plan MUST follow the exact format specified below.

### Plan File Format

The plan file uses YAML frontmatter for machine parsing followed by rich markdown content. The YAML frontmatter MUST contain a `phases` array that lists every phase with its number and title. This array is parsed by automation to determine how many phases to execute.

Example structure:

```yaml
---
app: {app}
type: verify-quick-updates
generated: 2026-04-13T14:30:00+03:00
phases:
  - number: 1
    title: "Verify User Authentication Docs"
  - number: 2
    title: "Verify API Endpoint Changes"
---
```

**CRITICAL**: The `phases` array in the frontmatter MUST list every phase defined in the plan body. Phase numbers in the frontmatter MUST match `## Phase N:` headings in the markdown body.

**Note:** If every quick-update summary shows high confidence and self-verification passed cleanly, you may still produce phases — the goal is to bring documentation to full `update` quality, not just to fix known issues.

### Plan Body Sections

The markdown body MUST contain the following sections:

#### 1. Quick-Update Summary

A table of all quick-update artifacts being processed:

| Quick Update ID | Date | Docs Touched | Confidence | Uncertainty Areas |
|---|---|---|---|---|

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

Add a note that slices are flexible — not all three doc types (concept, pattern, feature) are required for every phase. Only verify/re-document what is warranted.

#### 3. Documentation Templates

Include three templates (Concept, Pattern, Feature) adapted from the universal templates in the Reference section below. Adapt code examples, file references, and terminology to match the application's language and framework conventions.

Each template MUST include an example based on an actual domain area from the application.

#### 4. Decision Guidance

Include verbatim from the Reference section below.

#### 5. Quality Checklists

Adapt the universal checklists from the Reference section, adding technology-specific verification steps from Step 5.

#### 6. Handling Uncertainty

Include verbatim from the Reference section below.

#### 7. Verification Requirements

**Golden Rule: If you cannot find evidence for a claim in the source code, do NOT document it as fact.**

Include a technology-specific verification summary table:

| What to Verify | How to Verify | Common Mistakes |
|---|---|---|

Also include an **Internal Consistency Check** requirement and an **Uncertainty Focus Areas** section listing the specific areas flagged across all quick-update summaries that warrant extra scrutiny.

#### 8. Mandatory Verification Protocol

A step-by-step protocol that MUST be executed before marking any document as complete. Create a technology-adapted version with these steps:

**Step 1: Key Services/Functions Verification** — For EVERY function/method listed in a "Key Services/Functions" table, search the source file and verify it is part of the public API. If not public/exported, remove it from the table and add it to an "Internal Implementation" note instead.

**Step 2: Reference Implementation Verification** — For EVERY function listed in "Reference Implementations", verify it exists and check its accessibility.

**Step 3: Document Review Checklist** — A final self-check confirming: every function name was searched in source, accessibility was verified for each, all public API items are correctly listed, and internal functions are properly noted.

Include these final self-check questions:

1. Can you point to the exact line of code for every claim?
2. Have you actually read the source file (not just searched)?
3. Have you verified example outputs match actual behavior?

#### 9. Verification Phases (Phase 1 through Phase N)

For each phase:

- **Quick Update(s)**: Which artifact ID(s) this phase consolidates
- **Summary**: What was changed in the original quick-update(s) and what documentation was affected
- **Coverage gaps to close**: Doc-worthy changes (from Step 2 gap detection) that have NO documentation yet and must be newly created in this phase. List the source surface and the target doc path (e.g., `{docs_dir}/features/<name>.md`). Write "None" if the gap detection found no missing documentation for this phase.
- **Uncertainty focus**: Specific areas flagged as uncertain that need extra verification
- **Documents to verify/re-document**: List of doc files with specific aspects to verify
- **Key files to analyze**: Source files to read for verification

#### 10. Execution Strategy

- Concepts first, then patterns, then features within each phase
- For each document: read existing doc, read source code, re-document if needed, verify consistency
- **Close every coverage gap**: create the missing documentation for each doc-worthy change listed under "Coverage gaps to close", following the matching template, and add it to the relevant INDEX.md
- Pay extra attention to uncertainty areas flagged in the quick-update summaries
- Run the Mandatory Verification Protocol on all documents before marking complete
- Cross-link between docs; update INDEX.md files after each phase

{include:partials/index-format.md}

#### 11. Success Criteria

- Every quick-update artifact in the manifest is represented by exactly one phase (no artifact dropped)
- All quick-update documentation has been verified against source code
- All coverage gaps have been closed — every doc-worthy change is now documented
- Documents meet the same quality bar as the `update` command output
- Uncertainty areas have been resolved with evidence-based content
- INDEX.md files are up to date
- No contradictions between docs (internal consistency check)

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
- Write the plan to `{output_path}`. Do NOT use any IDE-specific tools (like CreatePlan). Write the file directly.
- Do NOT modify repository source code or create git commits.
- Read-only git history is available when the project is a git repository. You may use `git log`, `git show`, `git diff`, `git blame`, and similar read-only commands to understand changes. Do not run any git commands that modify the repository.
