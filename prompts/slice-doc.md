# Document a Plan Slice

**Input**:

1. The path to the documentation plan: `{plan}`
2. The slice/phase number to document: `{phase_number}`

If any input is missing, ask the user.

---

## Goal

Read the documentation plan at the path above. Find the definition for slice (phase) `{phase_number}` and create every documentation file it specifies.

The plan carries the **decisions** for this run: which documents to create or update, which source files to analyze, per-document notes, and any **Template Adaptations** — repository-specific deltas to the templates below. The **methodology** is in this prompt: the templates, the decision guidance, and the rules for handling uncertainty are below, and they are authoritative. Where the plan's Template Adaptations section names a delta, apply it on top of these templates; otherwise follow them exactly.

Read the relevant source code files referenced in the plan and produce complete, accurate documentation.

## Steps

1. Read the plan and extract the phase definition for slice `{phase_number}`: the documents to produce, the key files to analyze, and any per-document notes.
2. Read the plan's **Template Adaptations** section, if present.
3. Read the source files named for this slice. Base every claim on what the code actually does.
4. Write each document to the path the plan specifies, following the template for its type.
5. Update the relevant `INDEX.md` for every file you create.

## Notes

- Base every claim on evidence from the source code.
- Follow the templates below exactly so verification can compare structure.
- Save documentation files to the paths specified by the plan for this slice.

---

{include:partials/document-templates.md}

---

{include:partials/decision-guidance.md}

---

{include:partials/handling-uncertainty.md}

---

## INDEX.md Maintenance

After creating documents, add a row for each to the `INDEX.md` of its directory.

{include:partials/index-format.md}
