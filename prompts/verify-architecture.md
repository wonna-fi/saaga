# Verify the Architecture Document

**Input**:

1. Documentation plan: `{plan}`
2. Write the verification report to: `{review_path}`
3. Write the verification status to: `{status_path}` -- write exactly `PASS` if 0 errors found, or `FAIL` otherwise. Nothing else in this file.
4. Today's date: `{date}` -- used to stamp `last_verified` in Step 7. Use this value verbatim; do not compute a date yourself.

If any input is missing, ask the user.

**Goal**: Review `{docs_dir}/ARCHITECTURE.md` and verify that its claims are factually
correct, that it stays within its budget, and that it does not restate content another
document owns. Report all errors found; do not fix them.

This document is generated before the plan exists and outside the per-phase verify/fix
loop, so this is the only pass that checks it. It is also the document most prone to
growth: it is the only one describing the whole system, so every fact has a plausible
excuse to live here.

---

## Step 1: Read the Plan

Read the plan file at `{plan}` and extract its **Architecture Document** section:

- The **line budget**: `ARCHITECTURE.md — <N> lines`. Step 3b enforces it. If the plan
  records no budget, skip Step 3b entirely — do not invent a number.
- The **owns / references** declaration: which facts this document owns, and which
  documents it links to for the rest. Step 3c enforces it. If the plan records none,
  fall back to the ownership table in Single Home per Fact below.

Also note every document path the plan lists anywhere. Step 3c may only name those paths
as link targets, because they are the only documents this run will create.

The ownership rules, the level-of-detail policy and the mandatory verification protocol
are in this prompt, below. They are authoritative; the plan records only this run's
decisions.

## Step 2: Read the Document

Read `{docs_dir}/ARCHITECTURE.md` in full. If it does not exist, write `FAIL` to
`{status_path}` and record that as the single finding.

ARCHITECTURE.md has no type template — the concept, pattern, convention and feature
templates do not apply to it. Do not flag it for missing template sections.

## Step 3: Review the Document

### 3a. Factual Verification

For every claim about the code — module responsibilities, dependencies, data flow,
entry points, the subcommands the CLI exposes — verify it against the actual source.
Follow the verification protocol below. Do NOT trust the document at face value.

Record a finding for any claim the source contradicts, and for any module the document
describes that does not exist.

### 3b. Budget

1. Count the document's lines, frontmatter included.
2. Below 1.2x the budget: no finding. The budget is a target, not a fence.
3. At or above 1.2x: identify the passages that fail the consequence test or belong to
   another document, ranked by how many lines each costs.
4. **If removing those passages would bring the document within its budget**, record a
   **Budget Overrun** finding and list them in the Evidence column — severity **Minor**
   below 1.5x, **Major** at or above it. A finding that does not name what to remove is
   not actionable by the fix step, so never raise one without the list.
5. **If the document is over budget but every passage earns its place**, record no error.
   The budget was set wrong, not the document. Note it under methodology improvement
   suggestions in Step 5 instead — the budget, the actual length, and the module count
   the budget was derived from.

### 3c. Ownership and Duplication

For each fact class the ownership table assigns to another document, this document may
carry the summary that table allows it and nothing more.

Record a **Duplication** finding for each of these, naming the exact passage and the
document that owns it:

- A flow's or workflow's step sequence written out here rather than linked.
- A walkthrough of the CLI — flag lists, exit codes, error-handling branches — rather
  than one paragraph naming the subcommands and a link.
- A per-module export list (`**Exports**: …`), or an interface table that the module's
  own concept or feature document owns.
- A term defined here that a concept document defines.

Name as the owner only a document path the plan lists (Step 1). If the plan names no
owner for a duplicated fact, record it under methodology improvements instead — the fix
step must not invent a link target.

Then check the other direction. For every path in the plan's `references` list, the
document should link to it: a summary that owns nothing below it is only useful if the
reader can reach what does. Record a **Missing Reference** finding (**Minor**) naming
the path and the section the link belongs in — normally the paragraph that summarises
the module or subject that document covers.

This document is written before any other exists, so on an `init` run it starts with no
links at all and every declared reference is missing. That is expected, and closing it
is this pass's job.

### 3d. Consequence Test

Record a **Consequence Test** finding (**Minor**) for any passage that fails the test
below even when the document is within budget:

- A `> Internal implementation:` block, or any description of a non-exported helper.
- A transcribed constant value or a list of internal helper names.
- A dependency list running longer than one line for a single module.

## Step 4: Compile Findings

For each error found, record:

| Field | Description |
|---|---|
| **Section** | The heading in ARCHITECTURE.md that contains the error |
| **Claim** | The specific incorrect claim. Claim types beyond a plain factual error: **Budget Overrun** (Step 3b), **Duplication** (Step 3c), **Missing Reference** (Step 3c), **Consequence Test** (Step 3d) |
| **Evidence** | What the source code actually shows; for a Budget Overrun, the ranked list of passages to remove; for a Duplication, the passage and the owning document's path |
| **Severity** | **Critical** (a module or interface that does not exist), **Major** (incorrect behavior, a document at or above 1.5x its budget, or a whole section restating what another document owns), or **Minor** (formatting, a modest overrun, a duplicated paragraph, a declared reference with no link, or content that is accurate but does not belong here) |
| **Preventable** | Whether the verification protocol below should have caught this, and if not, what improvement would help |

## Step 5: Write Verification Report

Write the full verification report to `{review_path}`. The report must contain:

1. **Budget**: the assigned budget, the actual line count, and the ratio
2. **Error count**: by severity (critical / major / minor)
3. **Error details**: the full findings table from Step 4
4. **Methodology improvement suggestions**: a mis-set budget, an ownership collision, or
   a duplicated fact with no owner in the plan. Use this entry format:
   - **Problem**: What went wrong
   - **Root Cause**: Why it happened
   - **Corrective Actions**: What should be fixed in the document
   - **Prevention**: What should change in the prompt or the plan to prevent it

## Step 6: Write Verification Status

Write the verification status to `{status_path}`:

- Write exactly `PASS` if 0 errors were found (no critical, no major, no minor).
- Write exactly `FAIL` otherwise.

The status file must contain only `PASS` or `FAIL` -- nothing else.

## Step 7: Stamp `last_verified` (PASS only)

**Only if Step 6 wrote `PASS`.** Set `last_verified: {date}` in the YAML frontmatter of
`{docs_dir}/ARCHITECTURE.md` — updating the field if it is already there, adding it if it
is not. Change nothing else in the document.

This is the only edit verification is ever allowed to make. A date that does not
correspond to a real passing review is worse than no date at all.

If the status was `FAIL`, do not touch the document — the fix step runs next, and the
document will be re-verified afterwards.

## Notes

- Base ALL conclusions on evidence from the source code. Never assume correctness.
- Do NOT fix the document during review. Only report findings. The single exception is
  the `last_verified` stamp in Step 7, written only on PASS.
- Finding nothing is a legitimate outcome. It means the writer did its job.
- Do NOT modify repository source code, or any file outside `{docs_dir}/` and the report
  and status paths above.

---

{include:partials/single-home.md}

---

{include:partials/lod-policy.md}

---

{include:partials/verification-protocol.md}
