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

#### 1. Approach: Vertical Slices

Include this mermaid diagram:

```
flowchart LR
    subgraph slice [Vertical Slice]
        C[Concepts] --> P[Patterns]
        P --> F[Features]
    end

    C -.-> |references| Code[(Source Code)]
    P -.-> |examples from| Code
    F -.-> |links to| C
    F -.-> |links to| P
```

#### 2. Phase 0: Setup Structure

Deliverables for Phase 0:

1. Create folder structure: `{docs_dir}/concepts/`, `{docs_dir}/patterns/`, `{docs_dir}/features/`
2. Create empty INDEX.md files for each folder

Do NOT create or modify any agent rule file (`AGENTS.md`, `CLAUDE.md`, Cursor `.mdc`, or Copilot instructions) in this phase. Installing the documentation guidance into rule files is handled separately by the `install-rules` step, which is the single source of truth for that content.

#### 3. Documentation Templates

Include three templates (Concept, Pattern, Feature) adapted from the universal templates in the Reference section below. Adapt code examples, file references, and terminology to match the application's language and framework conventions.

Each template MUST include an example based on an actual domain area from the application to illustrate the expected format and level of detail.

#### 4. Decision Guidance

Include verbatim from the Reference section below.

#### 5. Quality Checklists

Adapt the universal checklists from the Reference section, adding technology-specific verification steps from Step 2.

#### 6. Handling Uncertainty

Include verbatim from the Reference section below.

#### 7. Verification Requirements

**Golden Rule: If you cannot find evidence for a claim in the source code, do NOT document it as fact.**

Include a technology-specific verification summary table:

| What to Verify | How to Verify | Common Mistakes |
|---|---|---|
| (technology-specific rows) | | |

Also include an **Internal Consistency Check** requirement: after completing all documents in a slice, cross-reference behavior descriptions across concept, pattern, and feature docs. Verify claims don't contradict each other and update conflicting documents to be consistent with the actual code behavior.

#### 8. Mandatory Verification Protocol

A step-by-step protocol that MUST be executed before marking any document as complete. Create a technology-adapted version with these steps:

**Step 1: Key Services/Functions Verification** - For EVERY function/method listed in a "Key Services/Functions" table, search the source file and verify it is part of the public API. If not public/exported, remove it from the table and add it to an "Internal Implementation" note instead.

**Step 2: Reference Implementation Verification** - For EVERY function listed in "Reference Implementations", verify it exists and check its accessibility. Public functions are listed by name; internal functions are referenced by file name with a note.

**Step 3: Document Review Checklist** - A final self-check confirming: every function name was searched in source, accessibility was verified for each, all public API items are correctly listed, and internal functions are properly noted.

Adapt the specific verification commands to the technology (e.g., `Grep: "export.*functionName"` for TypeScript, `Grep: "public.*methodName"` for Apex/Java).

Include these final self-check questions:

1. Can you point to the exact line of code for every claim?
2. Have you actually read the source file (not just searched)?
3. Have you verified example outputs match actual behavior?

#### 9. Lessons Learned

Include an empty "Lessons Learned" section. It will be populated during execution as issues are discovered in reviews. Each entry format:

- **Problem**: What went wrong
- **Root Cause**: Why it happened
- **Corrective Actions**: What was fixed
- **Prevention**: How to avoid it in future slices

#### 10. Phase 1 through Phase N: Domain Slices

For each domain area discovered in Step 1c, create a phase with:

- **Concepts to document**: List the domain terms/building blocks in this area
- **Patterns to document**: List the reusable code approaches
- **Features to document**: List the user-facing capabilities
- **Key files to analyze**: List the primary source files for this domain area (with relative paths)

#### 11. Execution Strategy

- Phases are executed in order (later phases reference earlier concepts)
- Within each phase: concepts first, then patterns, then features
- Cross-link between docs; update INDEX.md files after each phase
- Run the Mandatory Verification Protocol on all documents before marking complete
- Reviews after each phase; findings go in Lessons Learned

{include:partials/index-format.md}

#### 12. Success Criteria

- AI agents can find relevant concepts by checking INDEX.md files
- Each concept doc explains where configuration lives and which services/functions to use
- Each pattern doc provides copy-pasteable code examples
- Each feature doc links to the concepts and patterns it uses

---

## Reference: Universal Methodology

{include:partials/document-templates.md}

---

{include:partials/decision-guidance.md}

---

{include:partials/handling-uncertainty.md}

---

{include:partials/quality-checklists.md}

---

## Notes

- Do NOT author or edit agent rule files (`AGENTS.md`, `CLAUDE.md`, Cursor `.mdc`, Copilot instructions); the `install-rules` step owns the documentation guidance written into them.
- If the application has an existing `{docs_dir}/ARCHITECTURE.md`, use it as a starting point for understanding domain areas.
- Write the plan to `{output_path}`. Do NOT use any IDE-specific tools (like CreatePlan). Write the file directly.
