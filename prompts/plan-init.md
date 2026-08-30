# Plan Domain Documentation for an Application

**Input**: The application to document is at the project root (`.`). The application name is `{app}`.

**Goal**: Analyze the application's codebase and produce a documentation plan, organized as vertical slices. Each slice covers one domain area with three documentation layers: **concepts**, **patterns**, and **features**. Repo-wide lexical rules are documented separately as **conventions**. Write the plan to `{output_path}`.

This command creates a PLAN only -- the plan will be executed phase-by-phase afterwards by a separate agent.

---

## Step 1: Codebase Analysis

### 1a. Understand the Technology Stack

Read the application's configuration files to identify:

- Programming language(s) and frameworks
- Package manager and dependencies
- Project structure conventions (directories, modules, layers)
- Testing framework(s)
- Build tools and configuration

### 1b. Read Existing Documentation

Check for existing documentation about this application:

- Read the `AGENTS.md` file in the workspace root for project-level context
- Check `README.md` for setup and development information
- Check `{docs_dir}/ARCHITECTURE.md` for existing architecture documentation
- Check if `{docs_dir}/concepts/`, `{docs_dir}/patterns/`, `{docs_dir}/features/`, `{docs_dir}/conventions/` already exist

If domain documentation already exists, note it in the plan and build upon it rather than replacing it.

### 1c. Discover Domain Areas

Explore the codebase to identify the natural domain boundaries. Look at:

- Directory structure (feature folders, module folders, etc.)
- Service/store/manager classes that group related functionality
- Screen/page/component groupings
- API endpoints or route definitions
- Shared utilities and cross-cutting concerns

If a `.saagaignore` file exists at the project root, it lists paths and patterns (using gitignore syntax) that are excluded from documentation scope. Do not include any matching files or directories as domain areas — skip them entirely during discovery.

For each domain area, note:

- What business capability it represents
- Which files/modules are involved
- Dependencies on other domain areas

### 1d. Identify Convention Families

Separately from the domain areas, look for rules the codebase holds itself to that
a reader could check with grep: naming (files, symbols, tests), file and directory
layout, error-message shape, import ordering, commit or branch naming. Read a
handful of files across different areas and note what is consistent.

Group what you find into **families** — one family per plan entry, never one per
individual rule. A family earns an entry only when the rule is real (the codebase
follows it in most places) and lexical (following it does not require understanding
a code flow; a rule that does is a pattern). Most repositories yield between zero
and four families.

If you find none, say so in one line and the run creates no `conventions/`
directory. Do not invent conventions to fill the category.

### 1e. Determine Dependency Order

Order the domain areas so that foundational concepts come first:

- Areas referenced by many others should be documented first
- Areas that depend on others should come later
- Group related areas into phases

---

## Step 2: Adapt Templates to the Technology

Based on the technology stack discovered in Step 1, determine:

{include:partials/adapt-templates-to-technology.md}

---

## Step 3: Write the Plan

Write the plan to `{output_path}`. The plan MUST follow the exact format specified below.

### Plan File Format

The plan file uses YAML frontmatter for machine parsing followed by rich markdown content. The YAML frontmatter MUST contain a `phases` array that lists every phase with its number and title. This array is parsed by automation to determine how many phases to execute.

Example structure:

```yaml
---
app: {app}
type: init
generated: 2026-04-13T14:30:00+03:00
phases:
  - number: 0
    title: "Setup Structure"
  - number: 1
    title: "Core Concepts and Data Model"
  - number: 2
    title: "Authentication and API Layer"
---
```

**CRITICAL**: The `phases` array in the frontmatter MUST list every phase defined in the plan body. Phase numbers in the frontmatter MUST match `## Phase N:` headings in the markdown body.

### Plan Body Sections

The markdown body of the plan MUST contain the following sections:

#### 1. Approach

State how this run slices the work: the domain areas found in Step 1c, the order
they are documented in, and why. Documentation is produced in vertical slices —
concepts first, then the patterns that use them, then the features built on both.
Convention families cut across every slice, so they are documented last, in one
phase of their own; name the families here, or say in one line that there are none.

#### 2. Phase 0: Setup Structure

Deliverables for Phase 0:

1. Create folder structure: `{docs_dir}/concepts/`, `{docs_dir}/patterns/`, `{docs_dir}/features/`. Add `{docs_dir}/conventions/` **only if** Step 1d found at least one convention family; otherwise omit it entirely — an empty category is worse than no category.
2. Create empty INDEX.md files for each folder created

Do NOT create or modify any agent rule file (`AGENTS.md`, `CLAUDE.md`, Cursor `.mdc`, or Copilot instructions) in this phase. Installing the documentation guidance into rule files is handled separately by the `install-rules` step, which is the single source of truth for that content.

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
- **Verification checks**: the technology-specific verification summary table for this repository, derived from Step 2.

| What to Verify | How to Verify | Common Mistakes |
|---|---|---|
| (technology-specific rows) | | |

If a template needs no adaptation, say so in one line. Never paste a template
into the plan.

#### 4. Phase 1 through Phase N: Domain Slices

For each domain area discovered in Step 1c, create a phase with:

- **Concepts to document**: List the domain terms/building blocks in this area
- **Patterns to document**: List the reusable code approaches
- **Features to document**: List the user-facing capabilities
- **Line budgets**: for every document listed above, one line of the form `<path> — <Core|Supporting|Peripheral>, <N> lines`. Assign the tier with the centrality test in the Level of Detail section, using the dependency order from Step 1e; pick N inside that tier's band from the size and complexity of the source it covers. This is a decision the verifier enforces — do not omit it.
- **Key files to analyze**: List the primary source files for this domain area (with relative paths)
- **Notes**: Anything specific to this slice the writer needs — gotchas, boundaries with other slices, docs to cross-link

#### 5. Final Phase: Conventions

Include this phase **only if** Step 1d found at least one convention family. It is
the last numbered phase, never Phase 0 — Phase 0 is written outside the verify/fix
loop, and a convention document has to be verified like any other.

- **Conventions to document**: one line per family, `{docs_dir}/conventions/<family>.md`
- **Key files to analyze**: the files the conforming and counter examples come from
- **Notes**: for each family, the rule in one sentence, and which pattern documents
  currently restate it — those restatements are deleted when the convention lands

Assign no line budgets here: convention documents are capped at 5–20 lines of body
by the template, and the cap replaces the budget.

#### 6. Execution Strategy

- Phases are executed in order (later phases reference earlier concepts)
- Within each phase: concepts first, then patterns, then features
- Cross-link between docs; update INDEX.md files after each phase
- Reviews after each phase

#### 7. Success Criteria

- AI agents can find relevant concepts by checking INDEX.md files
- Each concept doc explains where configuration lives and which services/functions to use
- Each pattern doc provides copy-pasteable code examples
- Each feature doc links to the concepts and patterns it uses
- Each convention doc states one family's rule with a conforming and a counter example, and no pattern doc restates it

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

- Do NOT author or edit agent rule files (`AGENTS.md`, `CLAUDE.md`, Cursor `.mdc`, Copilot instructions); the `install-rules` step owns the documentation guidance written into them.
- If the application has an existing `{docs_dir}/ARCHITECTURE.md`, use it as a starting point for understanding domain areas.
- Write the plan to `{output_path}`. Do NOT use any IDE-specific tools (like CreatePlan). Write the file directly.
