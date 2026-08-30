# Fix Documentation Errors

**Input**:

1. Documentation plan: `{plan}`
2. Phase/slice number: `{phase_number}`
3. Verification report to fix: `{review_path}`

If any input is missing, ask the user.

**Goal**: Read the verification report and fix every error described in it. Do not change anything that was not flagged as an error.

---

## Step 1: Read the Verification Report

Read the verification report at `{review_path}`. For each error, note:

- The **document** file path
- The **section** containing the error
- The **claim** that is incorrect
- The **evidence** showing what the source code actually says
- The **severity** (Critical, Major, Minor)
- The **corrective actions** (from the Methodology Improvement Suggestions section, if applicable)

## Step 2: Read the Plan

Read the documentation plan at `{plan}`. Extract:

- The **phase definition** for slice `{phase_number}` (which documents this slice owns)
- The **Template Adaptations**, if present (repository-specific deltas to the templates below)

The documentation templates, the quality checklists, and the level-of-detail policy your fixes must satisfy are in this prompt, below — not in the plan.

## Step 3: Fix Each Error

Process errors in order of severity: Critical first, then Major, then Minor.

For each error:

1. **Read the document** that contains the error
2. **Read the source code** referenced in the evidence
3. **Apply the fix** based on the evidence:
   - If a method/field/component doesn't exist: remove the incorrect reference
   - If a method is private, not public: remove it from "Key Services". Move it to "Internal Implementation" only if it passes the consequence test; otherwise delete it.
   - If a description is incomplete: add the missing information based on source code
   - If a cross-reference is broken: fix the link or replace with plain text if the target doesn't exist
   - If a structural section is missing: add it following the template below
   - If a value/constant is wrong: correct it based on source code
   - If it is a **Budget Overrun**: delete the passages the report names, in the order it ranked them, until the document is within its budget. Deleting is the fix — do not rewrite the document, and do not compensate by compressing prose elsewhere. If deleting every named passage still leaves the document over budget, stop there and say so; never delete something the report did not name in order to reach the number.
   - If it is a **Consequence Test** finding: delete the flagged passage, or reduce it to one line naming the mechanism and why it exists.
   - If it is a **Coverage Gap** (a documentation-worthy change with no documentation): write the missing documentation. Read the source surface named in the evidence, decide whether it belongs in a concept, pattern, or feature doc (use the Decision Guidance below), and either create the missing file at the path noted in the finding following the matching template, or add a section to the most appropriate existing doc. Base every claim on the source code, and update the relevant `INDEX.md` for any new file.
4. **Verify your fix** by re-reading the relevant source code to ensure accuracy

## Step 4: Update INDEX.md Files

If any fixes changed document titles or added/removed documents, update the corresponding INDEX.md files.

## Rules

- **Only fix what was flagged.** Do not rewrite sections that were not identified as errors.
- **Do not modify the verification report.** It is a record of what was found.
- **Follow the templates below.** All fixes must maintain the document structure they define, plus any deltas the plan's Template Adaptations section records.
- **Base all fixes on source code evidence.** Read the actual source files before making changes. Do not guess.
- **Preserve existing correct content.** Minimize changes to reduce the risk of introducing new errors.
- **"Preserve existing correct content" does not apply to a Budget Overrun or Consequence Test finding.** Those findings say that correct content should not be there. Deleting exactly what the report names is the required fix — this is the one case where removing accurate text is right.

---

{include:partials/document-templates.md}

---

{include:partials/decision-guidance.md}

---

{include:partials/lod-policy.md}

---

{include:partials/quality-checklists.md}

---

## INDEX.md Maintenance

{include:partials/index-format.md}
