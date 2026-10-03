# Plan a Staleness Sweep

**Input**: The application to document is at the project root (`.`). The application name is `{app}`. The documentation lives in `{docs_dir}`. A report listing the documents selected for this sweep is at `{stale_report_path}`.

**Goal**: Turn the selected documents into a verification plan and write it to `{output_path}`. Each phase in the plan will be executed by a verifier that checks every claim in the phase's documents against the current source code, and by a fixer that corrects whatever the verifier finds.

The sweep **verifies and corrects existing documents**. It does not create new documents and does not close coverage gaps for undocumented code — that is the `update` flow's job. A document is in this sweep because the source it covers may have moved on without it.

---

## Step 1: Read the Selection Report

Read `{stale_report_path}`. Each `## <path>` heading is one selected document (paths are relative to the project root), with the reason it was selected:

- `sources-changed` — a path its `sources` frontmatter covers changed on or after its `last_verified` date. The changed paths are listed under it.
- `never-verified` — it carries no `last_verified` stamp: it was never verified, or its last verification recorded findings against it.
- `no-sources` — it declares no `sources`, so nothing could tell whether it is stale.
- `no-frontmatter` — it has no frontmatter block at all.

## Step 2: Understand What Changed

For each selected document:

1. Read the document and the `sources` its frontmatter lists.
2. For `sources-changed`: read the changed paths listed for it. Read-only git history is available — `git log --since=<last_verified> -- <path>`, `git show`, `git diff` — and is the fastest way to see *what* changed, including renames (a rename lists both the old and the new path).
3. Name the claims in the document most likely to be wrong now: identifiers, paths, flags, tables of values, step sequences that touch the changed code.
4. For `never-verified`, `no-sources` and `no-frontmatter`: there is no change to narrow the check, so the whole document is in scope. Note which source files it describes, so the verifier knows where to look.

## Step 3: Group into Phases

- **Every document in the report MUST appear in exactly one phase.** Never drop one and never list one twice. After building the phase list, confirm that the union of all phases' documents equals the full set of `##` headings in the report.
- Group related documents together: documents sharing sources, or covering the same domain area, are verified more cheaply side by side, and contradictions between them surface in one review.
- Order phases so that foundational documentation is verified before what depends on it: concepts, then patterns, then conventions, then features.
- If `{docs_dir}/ARCHITECTURE.md` is selected, give it a phase of its own. The verifier checks it against the ownership rules rather than a type template.

## Step 4: Adapt Templates to the Technology

Based on the application's technology stack (read from config files or existing documentation), determine:

{include:partials/adapt-templates-to-technology.md}

## Step 5: Write the Plan

Write the plan to `{output_path}`. The plan MUST follow the exact format specified below.

### Plan File Format

The plan file uses YAML frontmatter for machine parsing followed by rich markdown content. The YAML frontmatter MUST contain a `phases` array that lists every phase with its number and title. This array is parsed by automation to determine how many phases to execute.

Example structure:

```yaml
---
app: {app}
type: sweep-stale-docs
generated: 2026-04-13T14:30:00+03:00
phases:
  - number: 1
    title: "Verify Permission Profile Docs"
  - number: 2
    title: "Verify CLI Feature Docs"
---
```

**CRITICAL**: The `phases` array in the frontmatter MUST list every phase defined in the plan body. Phase numbers in the frontmatter MUST match `## Phase N:` headings in the markdown body.

### Plan Body Sections

The markdown body MUST contain the following sections:

#### 1. Sweep Summary

A table of every selected document:

| Document | Reason | Last Verified | What Changed |
|---|---|---|---|

#### 2. Approach

State how this run groups the documents into phases and why.

#### 3. Template Adaptations

The document templates, decision guidance, the level-of-detail policy, quality
checklists and verification protocol are delivered to the verifier and the fixer
by their own prompts. Do NOT reproduce them here. In particular, never restate the
budget bands, the consequence test or the ownership table — the per-document budget
and the owns / references declaration you assign are decisions and belong in the plan;
the rules behind them do not.

Record only the **deltas** this repository needs — for example "treat a symbol as
public only if it is re-exported from `src/index.ts`", or a table column this
codebase needs that the template lacks. Optional sections, the User Flow /
Mechanism choice, and the conventions category are already part of the templates:
they are not deltas and do not belong here. Include:

- **Template deltas**: any section renamed, added, or justifiably omitted for this codebase.
- **Verification checks**: the technology-specific verification summary table for this repository, derived from Step 4.

| What to Verify | How to Verify | Common Mistakes |
|---|---|---|
| (technology-specific rows) | | |

If a template needs no adaptation, say so in one line. Never paste a template
into the plan.

#### 4. Verification Phases (Phase 1 through Phase N)

For each phase:

- **Documents to verify**: every document in this phase, each with its selection reason, what changed in the source it covers, and the specific claims to re-check
- **Line budgets**: for every document listed above, one line of the form `<path> — <Core|Supporting|Peripheral>, <N> lines`. Assign the tier with the centrality test in the Level of Detail section, then pick N inside that tier's band from the size and complexity of the source it covers. This is a decision the verifier enforces — do not omit it. Never assign a budget to a document under `{docs_dir}/conventions/`: the lowest band starts at 25 lines and the cap is 20, so a budget would order the writer past it. `{docs_dir}/ARCHITECTURE.md` has no tier: its line is `ARCHITECTURE.md — <N> lines`, where `N = 60 + 8 x (the number of modules the document describes)`, capped at 250.
- **Owns / references**: for every document listed above, one line of the form `<path> — owns: <fact classes>; references: <paths it links to instead of restating>`. Use the ownership table in Single Home per Fact; the `owns` half names what only this document may state, the `references` half names the documents it links to for everything else it touches. A fact named in one document's `owns` must not appear in another document's body — that document links to the owner instead. This is a decision the verifier enforces — do not omit it.
- **Key files to analyze**: the source files to read for verification — the documents' `sources` and the changed paths

#### 5. Execution Strategy

- Concepts first, then patterns, then conventions, then features within each phase
- For each document: read it, read the source it covers, and check every claim — the changed paths first, then the rest
- Correct what is wrong; do not expand a document beyond its budget to describe code it never covered
- A document missing `sources` frontmatter gets the list added while it is being corrected
- Cross-link between docs; keep INDEX.md files consistent with any corrected description

{include:partials/index-format.md}

#### 6. Success Criteria

- Every document in the selection report is represented by exactly one phase (no document dropped)
- Every claim in every selected document has been checked against the current source code
- Claims invalidated by the changed sources have been corrected
- Every selected document declares the `sources` its claims cover
- No contradictions between docs (internal consistency check)

---

## Reference: Universal Methodology

The following is delivered verbatim to the verifier and the fixer by their own
prompts. It is reproduced here as context for phasing decisions only — do NOT copy any of it into the plan.

{include:partials/document-templates.md}

---

{include:partials/decision-guidance.md}

---

{include:partials/lod-policy.md}

---

{include:partials/single-home.md}

---

{include:partials/handling-uncertainty.md}

---

{include:partials/quality-checklists.md}

---

## Notes

- The BASELINE file is NOT regenerated by this plan. A sweep corrects documentation without changing what has been documented.
- Write the plan to `{output_path}`. Do NOT use any IDE-specific tools (like CreatePlan). Write the file directly.
- Do NOT modify repository source code, documentation, or create git commits. This step only writes the plan.
- Read-only git history is available when the project is a git repository. You may use `git log`, `git show`, `git diff`, `git blame`, and similar read-only commands to understand changes. Do not run any git commands that modify the repository.
