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
3. Record each coverage gap (the source surface, and the concept/pattern/convention/feature doc that should exist for it). These gaps MUST be scoped into the artifact's phase so the slice re-documentation step creates the missing documentation — not just verifies existing docs.

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
`{docs_dir}/conventions/INDEX.md` is optional — the category exists only in
repositories that have convention families. Its absence is not an issue.

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

State how this run groups the work into phases and why. Documentation is produced
in vertical slices — concepts first, then the patterns that use them, then the
features built on both. Slices are flexible: not all doc types are required
for every phase, only what is warranted.

#### 3. Template Adaptations

The document templates, decision guidance, the level-of-detail policy, quality
checklists and verification protocol are delivered to the writer and the verifier
by their own prompts. Do NOT reproduce them here. In particular, never restate the
budget bands or the consequence test — the per-document budget you assign is a
decision and belongs in the plan; the rules behind it do not.

Record only the **deltas** this repository needs — for example "treat a symbol as
public only if it is re-exported from `src/index.ts`", or a table column this
codebase needs that the template lacks. Optional sections, the User Flow /
Mechanism choice, and the conventions category are already part of the templates:
they are not deltas and do not belong here. Include:

- **Template deltas**: any section renamed, added, or justifiably omitted for this codebase.
- **Verification checks**: the technology-specific verification summary table for this repository, derived from Step 5.

| What to Verify | How to Verify | Common Mistakes |
|---|---|---|
| (technology-specific rows) | | |

If a template needs no adaptation, say so in one line. Never paste a template
into the plan.

#### 4. Verification Phases (Phase 1 through Phase N)

For each phase:

- **Quick Update(s)**: Which artifact ID(s) this phase consolidates
- **Summary**: What was changed in the original quick-update(s) and what documentation was affected
- **Coverage gaps to close**: Doc-worthy changes (from Step 2 gap detection) that have NO documentation yet and must be newly created in this phase. List the source surface and the target doc path (e.g., `{docs_dir}/features/<name>.md`). Write "None" if the gap detection found no missing documentation for this phase.
- **Uncertainty focus**: Specific areas flagged as uncertain that need extra verification
- **Documents to verify/re-document**: List of doc files with specific aspects to verify
- **Line budgets**: for every document listed above — the coverage gaps to close and the documents to re-document alike — one line of the form `<path> — <Core|Supporting|Peripheral>, <N> lines`. Assign the tier with the centrality test in the Level of Detail section, then pick N inside that tier's band from the size and complexity of the source it covers. This is a decision the verifier enforces — do not omit it.
- **Key files to analyze**: Source files to read for verification

#### 5. Execution Strategy

- Concepts first, then patterns, then features within each phase
- For each document: read existing doc, read source code, re-document if needed, verify consistency
- **Close every coverage gap**: create the missing documentation for each doc-worthy change listed under "Coverage gaps to close", following the matching template, and add it to the relevant INDEX.md
- Pay extra attention to uncertainty areas flagged in the quick-update summaries
- Cross-link between docs; update INDEX.md files after each phase

{include:partials/index-format.md}

#### 6. Success Criteria

- Every quick-update artifact in the manifest is represented by exactly one phase (no artifact dropped)
- All quick-update documentation has been verified against source code
- All coverage gaps have been closed — every doc-worthy change is now documented
- Documents meet the same quality bar as the `update` command output
- Uncertainty areas have been resolved with evidence-based content
- INDEX.md files are up to date
- No contradictions between docs (internal consistency check)

---

## Reference: Universal Methodology

The following is delivered verbatim to the documentation writer and the
verifier by their own prompts. It is reproduced here as context for slicing
decisions only — do NOT copy any of it into the plan.

{include:partials/document-templates.md}

---

{include:partials/decision-guidance.md}

---

{include:partials/lod-policy.md}

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
