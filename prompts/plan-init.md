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
- Check `docs/ARCHITECTURE.md` for existing architecture documentation
- Check if `docs/concepts/`, `docs/patterns/`, `docs/features/` already exist

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

**Accessibility verification** - How to verify that a function/method/class is part of the public API:

- TypeScript/JavaScript: Is it `export`ed? Is it in the module's public barrel file (`index.ts`)?
- Apex/Java/C#: Is the visibility modifier `public`?
- Python: Does it follow the underscore convention (`_private` vs public)?
- Other: Determine the language's convention

**Component/module existence verification** - How to verify a component or module exists:

- React/React Native: Search for the component file and verify it exports the component
- LWC: Glob for `componentName/componentName.js`
- Other: Determine the framework's convention

**Configuration sources** - Where configuration lives:

- Environment variables, config files, constants files, metadata objects, etc.

**Data model references** - How to refer to data structures:

- TypeScript interfaces/types, database models, ORM entities, etc.

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

1. Create folder structure: `docs/concepts/`, `docs/patterns/`, `docs/features/`
2. Create empty INDEX.md files for each folder
3. Update `AGENTS.md` to add a documentation section for this application (if `AGENTS.md` does not exist, create it with a basic structure first)

Include the exact AGENTS.md text to add, adapted for the target application. The text must include:

- The three doc types with their INDEX.md paths and descriptions
- "When to use each type" guidance with examples relevant to the application
- Maintenance instructions:
  - "Before implementing new features, always check these docs to understand existing patterns and reuse existing services/modules."
  - "After implementing new features, document every new concept, pattern and feature added."
  - "After modifying existing features, check the related concepts, patterns and features, and update them if needed."

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

INDEX.md format:

```markdown
# {Type} Index

| Name | Description |
|------|-------------|
| [Example](./example.md) | Brief description |
```

#### 12. Success Criteria

- AI agents can find relevant concepts by checking INDEX.md files
- Each concept doc explains where configuration lives and which services/functions to use
- Each pattern doc provides copy-pasteable code examples
- Each feature doc links to the concepts and patterns it uses
- AGENTS.md tells new agents where to find this documentation

---

## Reference: Universal Templates

### CONCEPT TEMPLATE

File location: `docs/concepts/{concept-name}.md`

```markdown
# {Concept Name}

## Business Definition

{1-2 sentences explaining what this concept means from a business perspective}

## Configuration

| Source | Description |
|--------|-------------|
| `{config source}` | {What is configured here} |

**How to access:**
- `{ServiceOrModule}.{method}()` - {what it returns}
- `{ServiceOrModule}.{CONSTANT_NAME}` (constant) - {what it contains}

> **Note:** Distinguish between methods/functions (use `()`) and properties/constants (no parentheses, add type in parentheses).

## Data Storage

| Object/Model/Type | Field/Property | Purpose |
|--------|-------|---------|
| `{ModelName}` | `{fieldName}` | {What this field stores} |

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `{ModuleName}` | `{method}()` | {What it does} |

> **IMPORTANT:** Only list functions/methods that are part of the public API (exported, public visibility, etc.). Verify by checking the source file.

## Internal Implementation (optional)

> Functions below are internal and should not be called directly. They are documented for understanding the internal logic.
>
> - `{module}.{internalFunction}()` - {what it demonstrates}

## Reference Implementations

- `{FileName}` - {brief description of what the file demonstrates}
- `{ModuleName}.{publicFunction}()` - {brief description}

> **Note:** For internal/private functions, reference the file, not the function directly.

## Related Concepts

- [{Related Concept}](./related-concept.md)
```

### PATTERN TEMPLATE

File location: `docs/patterns/{pattern-name}.md`

````markdown
# {Pattern Name}

## When to Use

{Describe the situations when this pattern should be used}

## Pattern

```{language}
// {Step-by-step code example with comments}
{code}
```

## Key Points

- {Important thing to remember}
- {Another important thing}

## Reference Implementations

| File | Function/Method | Notes |
| --- | --- | --- |
| `{FileName}` | `{functionName}()` | {What makes this a good reference} |

> **IMPORTANT:** Only list public/exported functions. For internal functions that show interesting patterns, reference the file instead.

## Anti-Patterns

**Do NOT:**

- {Common mistake to avoid}
- {Another mistake}
````

### FEATURE TEMPLATE

File location: `docs/features/{feature-name}.md`

```markdown
# Feature: {Feature Name}

## Overview

{1-2 sentences describing what this feature does from a user perspective}

## Key Concepts

Before working with this feature, understand these concepts:
- [{Concept 1}](../concepts/concept-1.md)
- [{Concept 2}](../concepts/concept-2.md)

## Functional Specification

### User Flow

1. {Step 1 of the user journey}
2. {Step 2}
3. {Step 3}

### Validation Rules

- {Validation rule 1}
- {Validation rule 2}

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| {Edge case} | {What happens} |

## Technical Implementation

### Data Model

| Model/Type | Key Fields | Purpose |
|--------|------------|---------|
| `{ModelName}` | `{field1}`, `{field2}` | {Purpose} |

### Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `{ModuleName}` | `{method}()` | {What it does} |

### Screens/Components (if applicable)

| Component | Purpose |
|-----------|---------|
| `{ComponentName}` | {What it does} |

### API Calls (if applicable)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/path` | POST | {What it does} |

## Integration Points

- **Depends on**: {Features/services this feature requires}
- **Used by**: {Features that use this feature}
- **External systems**: {Third-party integrations involved}

## Extension Guide

{How to extend or build upon this feature}
```

---

## Reference: Decision Guidance

### Is it a Concept, Pattern, or Feature?

| Type | Definition | Example |
| --- | --- | --- |
| **Concept** | A building block or domain term used by multiple features. Answers "what is X and where does it live?" | Authentication State, Navigation Structure, API Client |
| **Pattern** | A reusable code approach for a common operation. Answers "how do I do X?" | Making API calls, Creating new screens, Handling errors |
| **Feature** | A user-facing capability with a complete flow. Answers "how does feature X work end-to-end?" | User Login, QR Code Scanning, Visit History |

**Rule of thumb:**

- If it's referenced by 3+ features → probably a **Concept**
- If it's a "how to" with code → probably a **Pattern**
- If a user would recognize it as something they do → probably a **Feature**

### How Detailed Should Each Doc Be?

| Type | Target Length | Must Answer |
| --- | --- | --- |
| **Concept** | 50-150 lines | What is it? Where is it configured? How do I access it? What are the gotchas? |
| **Pattern** | 50-100 lines | When do I use this? What's the code? What mistakes should I avoid? |
| **Feature** | 100-250 lines | What does it do? What's the user flow? What's the technical implementation? How do I extend it? |

### When to Stop Researching

Stop researching and start writing when you can:

1. Explain the concept/pattern/feature in one sentence
2. Point to the primary source file(s)
3. Identify at least one reference implementation
4. List the key fields/methods involved

If you cannot do all four after reading the listed key files + related files, note the gaps and proceed with what you know.

---

## Reference: Handling Uncertainty

### When Code Logic is Unclear

If you cannot determine the business logic from the code:

1. Document what the code **does**, not what you **assume** it should do
2. Add a note: `> **Note:** This behavior is inferred from code analysis. Verify with domain expert if business intent is unclear.`
3. Still create the doc - partial documentation is better than none

### When Multiple Patterns Exist

If you find multiple ways to do the same thing:

1. Document the **most recent/common** pattern as the primary approach
2. Note alternatives: `> **Alternative:** Older code may use [X approach] - see [FileName]. New code should follow the pattern above.`

### When Information is Missing

If key information cannot be found:

1. Use placeholder with clear marker: `{TODO: Determine validation rules for X}`
2. Add to a "Gaps" section at the end of the doc:
   ```markdown
   ## Known Gaps

   - Validation rules for [X] not found in code - may be handled by the backend
   - Error messages not documented - check with QA
   ```

### When You Find Bugs or Inconsistencies

If you discover apparent bugs or inconsistencies while documenting:

1. Document the **current** behavior, not the "correct" behavior
2. Add a note: `> **Observation:** [Describe the inconsistency]. This may be intentional or a bug.`
3. Do not attempt to fix issues while documenting

---

## Reference: Quality Checklists (Universal Base)

### Concept Doc Checklist

- Business definition is understandable to someone unfamiliar with the codebase
- Configuration source is specified and verified (file/object/variable actually exists)
- "How to access" includes the correct module and function/method
- Data storage/model section lists all relevant fields
- At least 2 reference implementations are cited
- All referenced files/functions actually exist in the codebase
- Related concepts are linked (if any exist)
- **[VERIFICATION]** All constants/values lists are complete (check source-of-truth file)
- **[MANDATORY]** For EVERY function in "Key Services/Functions": Verify it is part of the public API
- **[MANDATORY]** Internal functions are NOT in "Key Services/Functions" - move to "Internal Implementation" section

### Pattern Doc Checklist

- "When to use" clearly describes the use cases
- Code example is complete and would work as-is
- Code example includes comments explaining each step
- Key points highlight non-obvious things an implementer might miss
- At least 2 reference implementations are cited
- Anti-patterns section warns about common mistakes
- All referenced files/functions actually exist in the codebase
- **[VERIFICATION]** Function parameter types match actual signatures
- **[MANDATORY]** For EVERY function in "Reference Implementations": Verify it is part of the public API

### Feature Doc Checklist

- Overview is understandable to a non-technical person
- Key concepts section links to relevant concept docs (or notes they need to be created)
- User flow matches what actually happens (verify against code)
- Validation rules are complete (check the service/controller/store code)
- Edge cases include error messages (check for error handling)
- Technical implementation lists all involved services/components
- Extension guide provides actionable steps for building similar features
- **[VERIFICATION]** All component/screen names actually exist (search the codebase)
- **[VERIFICATION]** Behavior claims are consistent with other docs in the slice
- **[MANDATORY]** For EVERY function in "Services/Functions" table: Verify it is part of the public API

---

## Notes

- If `AGENTS.md` already has documentation sections for other applications, follow the same structure when adding the new section.
- If the application has an existing `docs/ARCHITECTURE.md`, use it as a starting point for understanding domain areas.
- Write the plan to `{output_path}`. Do NOT use any IDE-specific tools (like CreatePlan). Write the file directly.
