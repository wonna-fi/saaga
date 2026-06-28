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
- The **corrective actions** (from the Plan Improvement Suggestions section, if applicable)

## Step 2: Read the Plan

Read the documentation plan at `{plan}`. Extract:

- The **Documentation Templates** (to ensure fixes maintain structural compliance)
- The **Quality Checklists** (to ensure fixes meet quality requirements)
- The **Verification Requirements** (to understand what will be checked again)

## Step 3: Fix Each Error

Process errors in order of severity: Critical first, then Major, then Minor.

For each error:

1. **Read the document** that contains the error
2. **Read the source code** referenced in the evidence
3. **Apply the fix** based on the evidence:
   - If a method/field/component doesn't exist: remove the incorrect reference
   - If a method is private, not public: move it from "Key Services" to "Internal Implementation"
   - If a description is incomplete: add the missing information based on source code
   - If a cross-reference is broken: fix the link or replace with plain text if the target doesn't exist
   - If a structural section is missing: add it following the template from the plan
   - If a value/constant is wrong: correct it based on source code
   - If it is a **Coverage Gap** (a documentation-worthy change with no documentation): write the missing documentation. Read the source surface named in the evidence, decide whether it belongs in a concept, pattern, or feature doc (use the Decision Guidance in the plan), and either create the missing file at the path noted in the finding following the matching template, or add a section to the most appropriate existing doc. Base every claim on the source code, and update the relevant `INDEX.md` for any new file.
4. **Verify your fix** by re-reading the relevant source code to ensure accuracy

## Step 4: Update INDEX.md Files

If any fixes changed document titles or added/removed documents, update the corresponding INDEX.md files.

## Rules

- **Only fix what was flagged.** Do not rewrite sections that were not identified as errors.
- **Do not modify the verification report.** It is a record of what was found.
- **Follow the plan's templates.** All fixes must maintain the document structure defined in the plan.
- **Base all fixes on source code evidence.** Read the actual source files before making changes. Do not guess.
- **Preserve existing correct content.** Minimize changes to reduce the risk of introducing new errors.
