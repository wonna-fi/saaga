# Plan Verification of Quick Updates

**Input**: The application to document is at the project root (`.`). The application name is `{app}`. A manifest of unverified quick-update metadata folders is at `{manifest_path}`. The metadata folders live under `{metadata_dir}`.

**Goal**: Read all unverified quick-update metadata artifacts, consolidate them into a verification plan, and write the plan to `{output_path}`. Each phase in the plan will be executed by an agent that re-documents the affected slice with full verification, bringing it to the same quality standard as the `update` command.

---

## Step 1: Read the Manifest

Read the manifest at `{manifest_path}`. It is a JSON file listing the quick-update IDs (folder names under `{metadata_dir}`).

For each ID, read:

1. `{metadata_dir}/<id>/changes.md` — the detect-changes report from the original quick-update run
2. `{metadata_dir}/<id>/summary.md` — the quick-update agent's self-report (YAML frontmatter + prose)

## Step 2: Analyze Quick Updates

For each quick-update artifact:

1. From `changes.md`: understand what source code changed
2. From `summary.md`: understand what documentation was modified, what the confidence level was, and what uncertainty areas were flagged
3. Read the current state of the documentation files listed in `docs_touched` to understand what exists now

### Gap detection (changed-but-undocumented surfaces)

The quick-update ran with a cheaper model under time pressure and may have **silently missed** a change that warrants documentation. `summary.md` only records what the quick-update agent was *aware* of — it cannot reveal an outright oversight. You MUST therefore reconcile what changed against what was documented:

1. From `changes.md`, enumerate the documentation-worthy changes: new/changed public APIs, exported functions/classes/modules, new features or user-facing flows, data-model or validation changes, integration/configuration changes, and architectural shifts. Ignore non-doc-worthy noise (pure styling, assets, tests, lockfiles, whitespace/comment-only edits, internal refactors that preserve public behavior).
2. Compare that list against `docs_touched` and the current documentation. Any doc-worthy change that has **no corresponding documentation** is a **coverage gap**.
3. Record each coverage gap (the source surface, and the concept/pattern/feature doc that should exist for it). These gaps MUST be scoped into the artifact's phase so the slice re-documentation step creates the missing documentation — not just verifies existing docs.

## Step 3: Consolidation

Group the quick updates into phases following these rules:

- **Every quick-update artifact in the manifest MUST be covered by exactly one phase.** Never drop an artifact, and never split a single quick-update across multiple phases. Each artifact represents a real documentation change (the quick-update only produced an artifact when it reported `UPDATED`), so each one warrants a phase even if its summary claims high confidence. After building the phase list, confirm that the union of all phases' artifact IDs equals the full set of IDs in the manifest.
- **Small, related quick-updates SHOULD be consolidated into one phase.** Quick updates are related when they touch overlapping documentation files or cover the same domain area. Consolidating is desirable — it reduces redundant verification work.
- **Order phases** so that foundational documentation (concepts) is verified before documentation that depends on it (patterns, features).

For each phase, identify:

- Which quick-update artifact(s) it consolidates
- Which documentation files need verification
- **Which coverage gaps must be closed** — doc-worthy changes from the gap detection in Step 2 that have no documentation yet and must be newly created in this phase
- What the uncertainty areas are (from the summary files)
- Which source files to analyze

## Step 4: Verify Documentation Structure

Verify that all three INDEX files exist:

- `docs/concepts/INDEX.md`
- `docs/patterns/INDEX.md`
- `docs/features/INDEX.md`

If any are missing, note it in the plan as a prerequisite issue.

## Step 5: Adapt Templates to the Technology

Based on the application's technology stack (read from config files or existing documentation), determine:

**Accessibility verification** — How to verify that a function/method/class is part of the public API:

- TypeScript/JavaScript: Is it `export`ed? Is it in the module's public barrel file (`index.ts`)?
- Apex/Java/C#: Is the visibility modifier `public`?
- Python: Does it follow the underscore convention (`_private` vs public)?
- Other: Determine the language's convention

**Component/module existence verification** — How to verify a component or module exists:

- React/React Native: Search for the component file and verify it exports the component
- LWC: Glob for `componentName/componentName.js`
- Other: Determine the framework's convention

**Configuration sources** — Where configuration lives:

- Environment variables, config files, constants files, metadata objects, etc.

**Data model references** — How to refer to data structures:

- TypeScript interfaces/types, database models, ORM entities, etc.

## Step 6: Write the Plan

Write the plan to `{output_path}`. The plan MUST follow the exact format specified below.

### Plan File Format

The plan file uses YAML frontmatter for machine parsing followed by rich markdown content. The YAML frontmatter MUST contain a `phases` array that lists every phase with its number and title. This array is parsed by automation to determine how many phases to execute.

Example structure:

```yaml
---
app: {app}
type: verify-quick-updates
generated: 2026-04-13T14:30:00+03:00
phases:
  - number: 1
    title: "Verify User Authentication Docs"
  - number: 2
    title: "Verify API Endpoint Changes"
---
```

**CRITICAL**: The `phases` array in the frontmatter MUST list every phase defined in the plan body. Phase numbers in the frontmatter MUST match `## Phase N:` headings in the markdown body.

**Note:** If every quick-update summary shows high confidence and self-verification passed cleanly, you may still produce phases — the goal is to bring documentation to full `update` quality, not just to fix known issues.

### Plan Body Sections

The markdown body MUST contain the following sections:

#### 1. Quick-Update Summary

A table of all quick-update artifacts being processed:

| Quick Update ID | Date | Docs Touched | Confidence | Uncertainty Areas |
|---|---|---|---|---|

#### 2. Approach

Include this mermaid diagram showing the vertical slice structure:

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

Add a note that slices are flexible — not all three doc types (concept, pattern, feature) are required for every phase. Only verify/re-document what is warranted.

#### 3. Documentation Templates

Include three templates (Concept, Pattern, Feature) adapted from the universal templates in the Reference section below. Adapt code examples, file references, and terminology to match the application's language and framework conventions.

Each template MUST include an example based on an actual domain area from the application.

#### 4. Decision Guidance

Include verbatim from the Reference section below.

#### 5. Quality Checklists

Adapt the universal checklists from the Reference section, adding technology-specific verification steps from Step 5.

#### 6. Handling Uncertainty

Include verbatim from the Reference section below.

#### 7. Verification Requirements

**Golden Rule: If you cannot find evidence for a claim in the source code, do NOT document it as fact.**

Include a technology-specific verification summary table:

| What to Verify | How to Verify | Common Mistakes |
|---|---|---|

Also include an **Internal Consistency Check** requirement and an **Uncertainty Focus Areas** section listing the specific areas flagged across all quick-update summaries that warrant extra scrutiny.

#### 8. Mandatory Verification Protocol

A step-by-step protocol that MUST be executed before marking any document as complete. Create a technology-adapted version with these steps:

**Step 1: Key Services/Functions Verification** — For EVERY function/method listed in a "Key Services/Functions" table, search the source file and verify it is part of the public API. If not public/exported, remove it from the table and add it to an "Internal Implementation" note instead.

**Step 2: Reference Implementation Verification** — For EVERY function listed in "Reference Implementations", verify it exists and check its accessibility.

**Step 3: Document Review Checklist** — A final self-check confirming: every function name was searched in source, accessibility was verified for each, all public API items are correctly listed, and internal functions are properly noted.

Include these final self-check questions:

1. Can you point to the exact line of code for every claim?
2. Have you actually read the source file (not just searched)?
3. Have you verified example outputs match actual behavior?

#### 9. Verification Phases (Phase 1 through Phase N)

For each phase:

- **Quick Update(s)**: Which artifact ID(s) this phase consolidates
- **Summary**: What was changed in the original quick-update(s) and what documentation was affected
- **Coverage gaps to close**: Doc-worthy changes (from Step 2 gap detection) that have NO documentation yet and must be newly created in this phase. List the source surface and the target doc path (e.g., `docs/features/<name>.md`). Write "None" if the gap detection found no missing documentation for this phase.
- **Uncertainty focus**: Specific areas flagged as uncertain that need extra verification
- **Documents to verify/re-document**: List of doc files with specific aspects to verify
- **Key files to analyze**: Source files to read for verification

#### 10. Execution Strategy

- Concepts first, then patterns, then features within each phase
- For each document: read existing doc, read source code, re-document if needed, verify consistency
- **Close every coverage gap**: create the missing documentation for each doc-worthy change listed under "Coverage gaps to close", following the matching template, and add it to the relevant INDEX.md
- Pay extra attention to uncertainty areas flagged in the quick-update summaries
- Run the Mandatory Verification Protocol on all documents before marking complete
- Cross-link between docs; update INDEX.md files after each phase

INDEX.md format:

```markdown
# {Type} Index

| Name | Description |
|------|-------------|
| [Example](./example.md) | Brief description |
```

#### 11. Success Criteria

- Every quick-update artifact in the manifest is represented by exactly one phase (no artifact dropped)
- All quick-update documentation has been verified against source code
- All coverage gaps have been closed — every doc-worthy change is now documented
- Documents meet the same quality bar as the `update` command output
- Uncertainty areas have been resolved with evidence-based content
- INDEX.md files are up to date
- No contradictions between docs (internal consistency check)

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
3. Still create the doc — partial documentation is better than none

### When Multiple Patterns Exist

If you find multiple ways to do the same thing:

1. Document the **most recent/common** pattern as the primary approach
2. Note alternatives: `> **Alternative:** Older code may use [X approach] — see [FileName]. New code should follow the pattern above.`

### When Information is Missing

If key information cannot be found:

1. Use placeholder with clear marker: `{TODO: Determine validation rules for X}`
2. Add to a "Gaps" section at the end of the doc:
   ```markdown
   ## Known Gaps

   - Validation rules for [X] not found in code — may be handled by the backend
   - Error messages not documented — check with QA
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
- **[MANDATORY]** Internal functions are NOT in "Key Services/Functions" — move to "Internal Implementation" section

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

- The BASELINE file is NOT regenerated by this plan. BASELINE regeneration is managed by the tool after all phases complete.
- Write the plan to `{output_path}`. Do NOT use any IDE-specific tools (like CreatePlan). Write the file directly.
