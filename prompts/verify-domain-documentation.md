# Verify Domain Documentation Slice

**Input**:

1. Documentation plan: `{plan}`
2. Phase/slice number to verify: `{phase_number}`
3. Write the verification report to: `{review_path}`
4. Write the verification status to: `{status_path}` -- write exactly `PASS` if 0 errors found, or `FAIL` otherwise. Nothing else in this file.
5. Changes source directory: `{changes_dir}` -- the directory holding the raw change reports this slice is supposed to cover. If this value is `none` (or remains an unfilled placeholder), there is no coverage source: skip the coverage check in Step 3d entirely.

If any input is missing, ask the user.

**Goal**: Review every document produced in the specified slice and verify that all claims are factually correct and evidence-based. When a changes source is provided, ALSO verify that every documentation-worthy change is actually covered by documentation -- a change that warrants documentation but is missing from the docs is an error. Report all errors found and evaluate whether they could have been prevented through plan improvements.

---

## Step 1: Read the Plan

Read the plan file and extract:

- The **phase definition** for the specified slice (concepts, patterns, and features listed)
- The **Quality Checklists** (to know what to verify for each doc type)
- The **Mandatory Verification Protocol** (the step-by-step verification procedure)
- The **Verification Requirements** (technology-specific checks and the verification summary table)
- The **Documentation Templates** (to check structural completeness)

## Step 2: Identify Documents to Review

From the phase definition, determine which documents were created. Find them in the `docs/concepts/`, `docs/patterns/`, and `docs/features/` directories.

Review documents in this order: concepts first, then patterns, then features (same order they were created).

## Step 3: Review Each Document

For each document, perform the following checks by searching the actual source code. Do NOT trust the documentation at face value.

### 3a. Structural Completeness

Compare the document against the template for its type (concept/pattern/feature). Flag any missing required sections.

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
| Constants/values are complete | Read the source-of-truth file and compare all values |

### 3c. Cross-Document Consistency

After reviewing all documents in the slice, check that:

- Behavior descriptions don't contradict each other across concept, pattern, and feature docs
- Cross-references (links to other docs) point to documents that exist
- Terminology is used consistently

### 3d. Coverage Verification (changed-but-undocumented surfaces)

**Skip this step entirely if `{changes_dir}` is `none` or an unfilled placeholder.** Sections 3a–3c verify that what *was* written is correct; this section verifies that everything that *should* have been written actually exists. A quick-update may have silently missed a documentation-worthy change, and that omission leaves no trace in the documents themselves — so it must be caught here against the raw change report.

1. **Locate the change report(s) for this slice.** From the plan's phase definition (Step 1), read the quick-update artifact ID(s) this phase consolidates. For each ID, read the raw change report at `{changes_dir}/<id>/changes.md`. (If the phase definition does not list explicit IDs, read every `changes.md` directly under `{changes_dir}`.)

2. **Enumerate documentation-worthy changes.** From the change report(s), list the changed/new source surfaces that warrant documentation: new or changed public APIs, exported functions/classes/modules, new features or user-facing flows, data-model or validation changes, integration/configuration changes, and architectural shifts. Ignore non-doc-worthy noise: pure styling, assets, tests, lockfiles, whitespace/comment-only edits, and pure internal refactors that preserve public behavior.

3. **Check each doc-worthy change for coverage.** For every doc-worthy change, search `docs/concepts/`, `docs/patterns/`, and `docs/features/` for documentation that actually reflects it. Coverage means a real, evidence-based description of the new/changed surface — not merely that a file name appears somewhere.

4. **Flag every uncovered change as a Coverage Gap error.** If a doc-worthy change has no corresponding documentation, record it as an error (see Step 4) with claim type "Coverage Gap". Severity is **Critical** when an entirely new public surface or feature is undocumented, and **Major** when an existing documented surface changed but its doc was not updated. Do NOT mark an undocumented-but-non-doc-worthy change as an error.

> Note: A correctly `SKIPPED` change (genuinely not doc-worthy) is NOT a coverage gap. Only flag changes that genuinely warrant documentation.

## Step 4: Compile Findings

For each error found, record:

| Field | Description |
|---|---|
| **Document** | File path of the document (for a Coverage Gap where no doc exists yet, write the expected target path, e.g. `docs/features/<name>.md`, and mark it `(missing)`) |
| **Section** | Which section contains the error (for a Coverage Gap, the undocumented source surface) |
| **Claim** | The specific incorrect claim, or for a Coverage Gap the doc-worthy change that is missing from the documentation |
| **Evidence** | What the source code actually shows (for a Coverage Gap, the change-report entry plus the source surface that warrants documentation) |
| **Severity** | **Critical** (wrong API, non-existent method, or an entirely undocumented new public surface/feature), **Major** (incorrect behavior, or a documented surface whose change was not reflected), or **Minor** (formatting, incomplete list) |
| **Preventable** | Whether the plan's verification protocol should have caught this, and if not, what improvement would help |

## Step 5: Write Verification Report

Write the full verification report to `{review_path}`. The report must contain:

1. **Documents reviewed**: Total count and list
2. **Error count**: By severity (critical / major / minor)
3. **Error details**: The full findings table from Step 4
4. **Plan improvement suggestions**: If errors reveal gaps in the plan's verification requirements, quality checklists, or templates, describe specific improvements. Use the Lessons Learned entry format:
   - **Problem**: What went wrong
   - **Root Cause**: Why it happened
   - **Corrective Actions**: What should be fixed in the documents
   - **Prevention**: What should be added to the plan to prevent this in future slices

## Step 6: Write Verification Status

Write the verification status to `{status_path}`:

- Write exactly `PASS` if 0 errors were found (no critical, no major, no minor — and no Coverage Gap errors from Step 3d).
- Write exactly `FAIL` otherwise.

The status file must contain only `PASS` or `FAIL` -- nothing else.

## Notes

- Base ALL conclusions on evidence from the source code. Never assume correctness.
- If a claim cannot be verified (e.g., the source file doesn't exist in the repo), flag it as unverifiable rather than assuming it's wrong.
- Do NOT fix the documents during review. Only report findings. Fixes are a separate step.
- Be thorough. A missed error here becomes permanent misinformation for future AI agents.
- You don't necessarily find any errors if the documentation is of excellent quality. That's okay! It
  only means that the documenter has done an excellent job and we should be happy for it.
