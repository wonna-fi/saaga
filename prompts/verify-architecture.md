# Verify the Architecture Document

**Input**:

1. Documentation plan: `{plan}`
2. Write the verification report to: `{review_path}`
3. Write the verification status to: `{status_path}` -- write exactly `PASS` when no Critical error, no Major error and no Missing Reference finding remain, or `FAIL` otherwise. Nothing else in this file.
4. Today's date: `{date}` -- used to stamp `last_verified` in Step 7. Use this value verbatim; do not compute a date yourself.
5. Deferred-findings report to write: `{deferred_minors_path}` -- the audit trail for findings nothing will act on (Step 8).
6. This verification round: `{iteration}` of `{loop_max}` -- when the two are equal this is the last round: the fix step still runs, but nothing verifies its work.

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
is this pass's job — which is why a Missing Reference is the one **Minor** that still
holds `PASS` back (Step 6). Every other Minor can wait for a later pass; a missing link
cannot, because the fix step is the only thing in the pipeline that inserts one and it
runs only on `FAIL`. Passing with them outstanding leaves ARCHITECTURE.md a dead end for
the life of the corpus.

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

- Write exactly `PASS` if the findings table holds no **Critical** and no **Major**
  error, and no **Missing Reference** finding. Other Minor findings do not fail the
  document.
- Write exactly `FAIL` otherwise.

The status file must contain only `PASS` or `FAIL` -- nothing else.

Missing References are the carve-out, and the reason is in Step 3c: they are Minor, and
they still gate the pass, because the fix step that adds the links runs only on `FAIL`.

A `PASS` with other minors recorded is a real pass, not a rounding of one. The finding
stays in the report from Step 5, the document loses its `last_verified` stamp in Step 7,
and Step 8 records it. Grade severities honestly either way: a Major written down as a
Minor to end the loop early buys a couple of saved agent sessions with a wrong document.

## Step 7: Stamp `last_verified`

The stamp is per document and there is one document here, so your findings table decides
it on its own — it has no Document column because every row is about
`{docs_dir}/ARCHITECTURE.md`:

- **The findings table is empty** — set `last_verified: {date}` in the YAML frontmatter
  of `{docs_dir}/ARCHITECTURE.md`, updating the field if it is already there, adding it
  if it is not. Change nothing else in the document.
- **The table holds even one row, of any severity** — **delete** the `last_verified`
  line from that frontmatter if it has one, and add nothing. Change nothing else.

Do this on every round, whatever Step 6 wrote. Delete or add the single `last_verified:`
line and leave every other line of the frontmatter byte-identical.

These two edits are the only ones this pass is allowed to make. A date that does not
correspond to a real passing review is worse than no date at all, and a document with no
date is how this pipeline says "verification pending" — the fix step runs next, and on
the last round nothing checks its work.

If the document has no frontmatter block at all, leave it alone rather than adding one
here.

## Step 8: Record Deferred Findings

Findings this run leaves unverified go to `{deferred_minors_path}`, the audit trail for
every stamp Step 7 removed. Write it only when nothing downstream will check them again:

- Step 6 wrote `PASS` and the findings table is not empty.
- Step 6 wrote `FAIL` and this is the final round: the round number above, `{iteration}`,
  is equal to the cap, `{loop_max}`. The fix step still runs, but nothing verifies its
  work.

Write nothing when the findings table is empty, and nothing when Step 6 wrote `FAIL`
with rounds left: those findings go to the fix step and come back to the next round.

Your findings table has no Document column, so write `{docs_dir}/ARCHITECTURE.md` into
the report's Document column for every row. The report's format is in The
Deferred-Findings Report, below.

## Notes

- Base ALL conclusions on evidence from the source code. Never assume correctness.
- Do NOT fix the document during review. Only report findings. The single exceptions are
  Step 7, which adds or deletes `last_verified` and touches nothing else, and Step 8,
  which writes only to `{deferred_minors_path}`.
- Finding nothing is a legitimate outcome. It means the writer did its job.
- Do NOT modify repository source code, or any file outside `{docs_dir}/`, the report and
  status paths above, and `{deferred_minors_path}`.

---

{include:partials/single-home.md}

---

{include:partials/lod-policy.md}

---

{include:partials/verification-protocol.md}

---

{include:partials/deferred-findings.md}
