# Plan Domain Documentation for an Application

**Input**: The application to document is at the project root (`.`). The application name is `{app}`.

**Goal**: Analyze the application's codebase and produce a documentation plan, organized as vertical slices. Each slice covers one domain area with three documentation layers: **concepts**, **patterns**, and **features**. Write the plan to `{output_path}`.

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
- Check if `{docs_dir}/concepts/`, `{docs_dir}/patterns/`, `{docs_dir}/features/` already exist

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

### 1d. Determine Dependency Order

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

#### 2. Phase 0: Setup Structure

Deliverables for Phase 0:

1. Create folder structure: `{docs_dir}/concepts/`, `{docs_dir}/patterns/`, `{docs_dir}/features/`
2. Create empty INDEX.md files for each folder

Do NOT create or modify any agent rule file (`AGENTS.md`, `CLAUDE.md`, Cursor `.mdc`, or Copilot instructions) in this phase. Installing the documentation guidance into rule files is handled separately by the `install-rules` step, which is the single source of truth for that content.

#### 3. Template Adaptations

The document templates, decision guidance, the level-of-detail policy, quality
checklists and verification protocol are delivered to the writer and the verifier
by their own prompts. Do NOT reproduce them here. In particular, never restate the
budget bands or the consequence test — the per-document budget you assign is a
decision and belongs in the plan; the rules behind it do not.

Record only the **deltas** this repository needs — for example "rename User Flow
to Execution Flow for engine features", or "treat a symbol as public only if it
is re-exported from `src/index.ts`". Include:

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
- **Line budgets**: for every document listed above, one line of the form `<path> — <Core|Supporting|Peripheral>, <N> lines`. Assign the tier with the centrality test in the Level of Detail section, using the dependency order from Step 1d; pick N inside that tier's band from the size and complexity of the source it covers. This is a decision the verifier enforces — do not omit it.
- **Key files to analyze**: List the primary source files for this domain area (with relative paths)
- **Notes**: Anything specific to this slice the writer needs — gotchas, boundaries with other slices, docs to cross-link

#### 5. Execution Strategy

- Phases are executed in order (later phases reference earlier concepts)
- Within each phase: concepts first, then patterns, then features
- Cross-link between docs; update INDEX.md files after each phase
- Reviews after each phase

#### 6. Success Criteria

- AI agents can find relevant concepts by checking INDEX.md files
- Each concept doc explains where configuration lives and which services/functions to use
- Each pattern doc provides copy-pasteable code examples
- Each feature doc links to the concepts and patterns it uses

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
