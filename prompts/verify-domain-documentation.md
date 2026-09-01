# Verify Domain Documentation Slice

**Input**:

1. Documentation plan: `{plan}`
2. Phase/slice number to verify: `{phase_number}`
3. Write the verification report to: `{review_path}`
4. Write the verification status to: `{status_path}` -- write exactly `PASS` when no Critical and no Major error was found, or `FAIL` otherwise. Nothing else in this file.
5. Changes source directory: `{changes_dir}` -- the directory holding the raw change reports this slice is supposed to cover. If this value is `none` (or remains an unfilled placeholder), there is no coverage source: skip the coverage check in Step 3d entirely.
6. Today's date: `{date}` -- used to stamp `last_verified` in Step 7. Use this value verbatim; do not compute a date yourself.
7. Deferred-findings report to write: `{deferred_minors_path}` -- this slice's audit trail for findings nothing will act on (Step 8).
8. This verification round: `{iteration}` of `{loop_max}` -- when the two are equal this is the last round, so a `FAIL` here is final: the fix step still runs, but nothing verifies its work.

If any input is missing, ask the user.

**Goal**: Review every document produced in the specified slice and verify that all claims are factually correct and evidence-based. When a changes source is provided, ALSO verify that every documentation-worthy change is actually covered by documentation -- a change that warrants documentation but is missing from the docs is an error. Report all errors found and evaluate whether they could have been prevented through plan improvements.

---

## Step 1: Read the Plan

Read the plan file and extract:

- The **phase definition** for the specified slice (concepts, patterns, conventions, and features listed)
- The **Template Adaptations** section, if present: repository-specific deltas to the templates below, plus its **Verification checks** table naming the technology-specific checks recorded for this repository
- The **line budget** recorded for each document in this slice (its tier and its exact number). Step 3e enforces it. A document the plan gave no budget is not checked in 3e. Convention documents never carry a budget: their cap comes from the template and `validate-docs` enforces it.
- The **owns / references** declaration recorded for each document in this slice: which facts the document owns, and which documents it links to for the rest. Step 3f enforces it. A document the plan gave no declaration is not checked in 3f.

The quality checklists, the documentation templates, the level-of-detail policy (the budget bands and the consequence test Step 3e applies) and the mandatory verification protocol are in this prompt, below. They are authoritative; the plan only records deltas — the per-document line budget, and the owns / references declaration.

## Step 2: Identify Documents to Review

From the phase definition, determine which documents were created. Find them in the `{docs_dir}/concepts/`, `{docs_dir}/patterns/`, `{docs_dir}/conventions/`, and `{docs_dir}/features/` directories.

Review documents in this order: concepts first, then patterns, then conventions, then features (same order they were created).

If the phase definition names `{docs_dir}/ARCHITECTURE.md`, that document is part of this
slice too. It is the one document with no type template, so skip Step 3a for it and check
it against the ownership rules in Single Home per Fact instead; every other step applies
to it normally.

## Step 3: Review Each Document

For each document, perform the following checks by searching the actual source code. Do NOT trust the documentation at face value.

### 3a. Structural Completeness

Compare the document against the template for its type (concept/pattern/convention/feature) in the Documentation Templates section below. Flag any missing **required** sections.

A section the template marks optional is not required. Do not flag a missing
`Configuration` or `Data Storage` on a concept that has neither — an omission is a
finding only when the subject demonstrably has the thing and the document hides it,
and the evidence for that is in the source, not in the template. The same applies to
the Functional Specification's opening heading: `User Flow` and `Mechanism` are
alternatives, and a feature carrying exactly one of them is correct. An empty
heading or an "N/A" stub, on the other hand, **is** a finding: the section should
have been omitted.

### 3b. Factual Verification

For every factual claim in the document, verify it against the source code:

| Claim Type | How to Verify |
|---|---|
| Function/method exists | Grep for the exact name in the codebase |
| Function is public/exported | Read the source file, check visibility/export |
| Parameter types/signatures | Read the actual method signature |
| Configuration source exists | Search for the file/object/variable |
| Component/screen exists | Glob for the component file |
| Data model fields exist | Search for the field name in model/schema definitions |
| Code example is correct | Trace the logic against actual source |
| Example output is accurate | Manually trace the code to verify formatting and values |
| Constants/values are complete | Read the source-of-truth file and compare all values (only for constants the document should carry at all — see 3e) |

### 3c. Cross-Document Consistency

After reviewing all documents in the slice, check that:

- Behavior descriptions don't contradict each other across concept, pattern, convention, and feature docs
- Cross-references (links to other docs) point to documents that exist
- Terminology is used consistently

### 3d. Coverage Verification (changed-but-undocumented surfaces)

**Skip this step entirely if `{changes_dir}` is `none` or an unfilled placeholder.** Sections 3a–3c verify that what *was* written is correct; this section verifies that everything that *should* have been written actually exists. A quick-update may have silently missed a documentation-worthy change, and that omission leaves no trace in the documents themselves — so it must be caught here against the raw change report.

1. **Locate the change report(s) for this slice.** From the plan's phase definition (Step 1), read the quick-update artifact ID(s) this phase consolidates. For each ID, read the raw change report at `{changes_dir}/<id>/changes.md`. (If the phase definition does not list explicit IDs, read every `changes.md` directly under `{changes_dir}`.)

2. **Enumerate documentation-worthy changes.** From the change report(s), list the changed/new source surfaces that warrant documentation: new or changed public APIs, exported functions/classes/modules, new features or user-facing flows, data-model or validation changes, integration/configuration changes, and architectural shifts. Ignore non-doc-worthy noise: pure styling, assets, tests, lockfiles, whitespace/comment-only edits, and pure internal refactors that preserve public behavior.

3. **Check each doc-worthy change for coverage.** For every doc-worthy change, search `{docs_dir}/concepts/`, `{docs_dir}/patterns/`, `{docs_dir}/conventions/`, and `{docs_dir}/features/` for documentation that actually reflects it. Coverage means a real, evidence-based description of the new/changed surface — not merely that a file name appears somewhere.

4. **Flag every uncovered change as a Coverage Gap error.** If a doc-worthy change has no corresponding documentation, record it as an error (see Step 4) with claim type "Coverage Gap". Severity is **Critical** when an entirely new public surface or feature is undocumented, and **Major** when an existing documented surface changed but its doc was not updated. Do NOT mark an undocumented-but-non-doc-worthy change as an error.

> Note: A correctly `SKIPPED` change (genuinely not doc-worthy) is NOT a coverage gap. Only flag changes that genuinely warrant documentation.

### 3e. Budget and Level of Detail

Sections 3a–3d ask whether what is written is correct and whether anything is missing.
This section asks the opposite question: is anything here that should not be?

Skip any document the plan assigned no budget. Legacy documents, and documents this run
did not write, are out of scope for this check — trimming those is `docs-gc`'s job, not
this loop's.

For each document that has an assigned budget:

1. Count its lines, frontmatter included.
2. Below 1.2x the budget: no finding. The budget is a target, not a fence.
3. At or above 1.2x: identify the passages that fail the consequence test, ranked by how
   many lines each costs.
4. **If removing those passages would bring the document within its budget**, record a
   **Budget Overrun** finding and list them in the Evidence column — severity **Minor**
   below 1.5x, **Major** at or above it. A finding that does not name what to remove is
   not actionable by the fix step, so never raise one without the list.
5. **If the document is over budget but every passage earns its place**, record no error.
   The budget was set wrong, not the document. Note it under Methodology improvement
   suggestions in Step 5 instead — name the document, its budget and its actual length —
   so the next plan assigns a better one. Deleting content that passes the consequence
   test in order to reach a number is never the right fix.

Separately, record a **Consequence Test** finding (**Minor**) for any passage that fails
the test even in a document that is within budget: a transcribed private constant value,
a list of internal helper names, or prose restating a function body.

### 3f. Ownership and Duplication

Step 3e asks whether a document says more than it should about its own subject. This step
asks whether it says anything about someone else's.

Skip any document the plan gave no owns / references declaration.

For each document that has one:

1. Take the `references` half: the documents this one links to rather than restates.
2. For each referenced document, check whether this document restates content that the
   referenced document owns — a step sequence, a flag list, an interface table, a term's
   definition — rather than linking to it. Use the ownership table in Single Home per Fact
   to decide who owns a fact when the declaration is ambiguous.
3. Record a **Duplication** finding for each restatement. Name the exact passage in the
   Evidence column and name the owning document, because the fix step replaces the passage
   with a link and can only link to what the report names. Severity **Major** when a whole
   section is duplicated, **Minor** for a paragraph or a table row.
4. A passage that names a fact in one sentence and links to the owner is not duplication.
   Neither is a fact this document's own `owns` half claims — if two documents both claim
   it, that is a plan error: record no finding and report the collision under methodology
   improvements in Step 5 instead.

## Step 4: Compile Findings

For each error found, record:

| Field | Description |
|---|---|
| **Document** | File path of the document (for a Coverage Gap where no doc exists yet, write the expected target path, e.g. `{docs_dir}/features/<name>.md`, and mark it `(missing)`). Record one row per document a finding implicates: Step 7 unstamps exactly the documents this column names, so a contradiction between two documents that names only one of them leaves the other stamped as verified |
| **Section** | Which section contains the error (for a Coverage Gap, the undocumented source surface) |
| **Claim** | The specific incorrect claim, or for a Coverage Gap the doc-worthy change that is missing from the documentation. Claim types beyond a plain factual error: **Coverage Gap** (Step 3d), **Budget Overrun** (Step 3e), **Consequence Test** (Step 3e), **Duplication** (Step 3f) |
| **Evidence** | What the source code actually shows (for a Coverage Gap, the change-report entry plus the source surface that warrants documentation) |
| **Severity** | **Critical** (wrong API, non-existent method, or an entirely undocumented new public surface/feature), **Major** (incorrect behavior, a documented surface whose change was not reflected, a document at or above 1.5x its assigned budget, or a whole section restating what another document owns), or **Minor** (formatting, incomplete list, or content that is accurate but does not belong in the document — including a document modestly over its budget, or a duplicated paragraph or table row) |
| **Preventable** | Whether the verification protocol below should have caught this, and if not, what improvement would help |

## Step 5: Write Verification Report

Write the full verification report to `{review_path}`. The report must contain:

1. **Documents reviewed**: Total count and list
2. **Error count**: By severity (critical / major / minor)
3. **Error details**: The full findings table from Step 4
4. **Methodology improvement suggestions**: If errors reveal gaps in the quality checklists, the documentation templates, or the verification protocol below — or in the plan's Template Adaptations — describe specific improvements. Note whether the gap belongs to the shared methodology (`prompts/partials/`) or to this run's plan. Use this entry format:
   - **Problem**: What went wrong
   - **Root Cause**: Why it happened
   - **Corrective Actions**: What should be fixed in the documents
   - **Prevention**: What should be added to the plan to prevent this in future slices

## Step 6: Write Verification Status

Write the verification status to `{status_path}`:

- Write exactly `PASS` if the findings table holds no **Critical** and no **Major**
  error. Minor findings do not fail the slice.
- Write exactly `FAIL` otherwise.

The status file must contain only `PASS` or `FAIL` -- nothing else.

Step 3d grades every Coverage Gap **Critical** or **Major**, so a documentation-worthy
change with no documentation always fails the slice.

A `PASS` with minors recorded is a real pass, not a rounding of one. The minors stay in
the report from Step 5, the documents they were recorded against lose their
`last_verified` stamp in Step 7, and Step 8 writes them to this slice's deferred-findings
report. Passing the slice ends the fix loop; it does not forget the finding.

Grade severities the same way you would if `PASS` still required an empty table. A Major
written down as a Minor to end the loop early buys three saved agent sessions with a
wrong document, which is the exact trade this threshold exists to avoid.

## Step 7: Stamp `last_verified` per Document

The stamp is per document, not per slice: it says *this* document was checked against
the source today and nothing was found wrong with it. What Step 6 wrote for the slice as
a whole does not enter into it.

For every document you reviewed in this slice:

- **No row of the findings table names it** — set `last_verified: {date}` in its YAML
  frontmatter, updating the field if it is already there, adding it if it is not. Change
  nothing else in the document.
- **A row names it in the Document column** — **delete** the `last_verified` line from
  its frontmatter if it has one, and add nothing. Change nothing else. A document with a
  finding against it is not verified, and a stamp left over from an earlier run would
  claim that it is.

Do this on every round, whatever Step 6 wrote.

These two edits are the only ones verification is ever allowed to make, and this is the
only place `last_verified` is ever written or removed. A later run uses it to decide
which documents have gone stale, so a date that does not correspond to a real passing
review is worse than no date at all — and a document with no date is how this pipeline
says "verification pending", including after the last round of a slice that never
passed, where the fix step's work is no longer checked by anything.

Three documents to skip:

- A finding recorded against a path marked `(missing)` has no document to unstamp.
- `{docs_dir}/README.md` and `{docs_dir}/GLOSSARY.md` are regenerated from the corpus on
  every run and never carry a stamp. Leave their frontmatter alone.
- A document without frontmatter is a pre-beta document: leave it alone rather than
  adding a frontmatter block to it here.

Delete or add the single `last_verified:` line. Leave every other line of the
frontmatter byte-identical.

## Step 8: Record Deferred Findings

Findings this run will not act on go to `{deferred_minors_path}`, this slice's audit
trail for every stamp Step 7 removed. Write it only when nothing downstream will fix
them:

- Step 6 wrote `PASS` and the findings table is not empty — the minors you passed on.
- Step 6 wrote `FAIL` and this is the final round: the round number above, `{iteration}`,
  is equal to the cap, `{loop_max}`. The fix step still runs, but nothing verifies its
  work, so those findings are left behind too.

Write nothing when the findings table is empty, and nothing when Step 6 wrote `FAIL`
with rounds left: those findings go to the fix step and come back to the next round.

The report's format is in The Deferred-Findings Report, below.

## Notes

- Base ALL conclusions on evidence from the source code. Never assume correctness.
- If a claim cannot be verified (e.g., the source file doesn't exist in the repo), flag it as unverifiable rather than assuming it's wrong.
- Do NOT fix the documents during review. Only report findings. Fixes are a separate step. The single exceptions are Step 7, which adds or deletes `last_verified` and touches nothing else, and Step 8, which writes only to `{deferred_minors_path}`.
- Be thorough. A missed error here becomes permanent misinformation for future AI agents.
- You don't necessarily find any errors if the documentation is of excellent quality. That's okay! It
  only means that the documenter has done an excellent job and we should be happy for it.

---

{include:partials/lod-policy.md}

---

{include:partials/single-home.md}

---

{include:partials/quality-checklists.md}

---

{include:partials/verification-protocol.md}

---

{include:partials/deferred-findings.md}

---

{include:partials/document-templates.md}
