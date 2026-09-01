---
title: Script Registry
type: concept
last_verified: 2026-09-01
sources:
  - src/scripts/registry.ts
  - src/engine/primitives/script.ts
  - src/scripts/*.ts
terms:
  - built-in script
  - script handler
  - script id
---

# Script Registry

## Business Definition

A **built-in script** is the deterministic half of a flow: a TypeScript function that a
`script:` step names by id and the runner calls in-process, rather than a prompt an agent
answers. Anything decidable in code — hashing the work tree, checking a plan against a
ceiling, rendering a generated page — is a script, so it costs no agent tokens and cannot
come out differently on two runs over the same input.

The **registry** is the id-to-handler map a step's `name` is looked up in. A **script id**
lives in exactly two places: as a key of the registry and as the filename stem of the
module exporting its handler — see [file layout](../conventions/file-layout.md).

## Configuration

| Source | Description | Precedence |
|--------|-------------|------------|
| `defaultScriptRegistry` (`src/scripts/registry.ts`) | The built-ins every flow can call | Used when the caller supplies nothing |
| `RunFlowDeps.scripts` | A registry the caller passes to `runFlow()` | Wins outright when present |

The override *replaces* the default rather than merging with it, so a caller passing a
partial map — as the engine tests do — has no built-ins at all. The product CLI never
passes one.

**How to access:**
- `defaultScriptRegistry` (constant) - the built-in id-to-handler map
- `ScriptRegistry` (type) - `Record<string, ScriptHandler>`

## Data Storage

| Type | Field/Property | Purpose |
|--------|-------|---------|
| `ScriptHandler` | `(args, ctx) => Promise<unknown>` | The shape every handler implements |
| `ScriptContext` | `cwd` | Working directory: the application being documented |
| `ScriptContext` | `warn?` | Emits a warning into the run output; absent when the caller has no logger in reach, which is why every use is optional-chained |

The contract with a `script:` step has three parts. Every key of the step other than
`name`, `set` and `label` arrives in `args` as a **string**, already interpolated against
scope, so a handler that wants a number or a boolean coerces it itself. The handler's
resolved value is assigned to the variable named by `set`, and nowhere otherwise — a step
with no `set` discards it. That value must be JSON-serialisable, because
[flow execution](../features/flow-execution.md) replays it out of the step journal when a
run resumes.

## Key Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `scripts/registry` | `defaultScriptRegistry` | The built-in registry |
| `scripts/registry` | `ScriptHandler`, `ScriptRegistry`, `ScriptContext` | The handler contract |
| `engine/primitives/script` | `runScriptStep()` | Resolve the handler, interpolate args, assign `set` |

### The built-ins

| Id | Purpose |
|----|---------|
| `parse-plan` | Read the `phases` array out of a plan's YAML frontmatter, for a `foreach` to walk |
| `check-plan-budget` | Decide a plan against the [corpus budget](./corpus-budget.md) |
| `check-format-version` | Refuse a flow whose templates do not match the corpus on disk |
| `stamp-format-version` | Write the format stamp onto a freshly generated corpus |
| `ensure-gitignore` | Add a pattern to the project's `.gitignore` |
| `generate-baseline` | Write [`BASELINE`](./baseline-and-change-detection.md) |
| `detect-changes` | Classify the work tree against `BASELINE` |
| `generate-navigation` | Rebuild the [generated pages](../features/navigation-generation.md) |
| `validate-docs` | Run the structural checks over the corpus |
| `install-rules` | Write always-on agent rules into the repository; see [install rules](../features/install-rules.md) |
| `archive-quick-update`, `collect-quick-updates`, `remove-quick-updates`, `cleanup-quick-update-dir` | The quick-update artifact lifecycle; see [quick-update workflows](../features/quick-update-workflows.md) |

Five of these are gates rather than producers — what each one fails a run for is owned by
[corpus gates](../features/corpus-gates.md).

## Reference Implementations

- `src/scripts/registry.ts` - the map and the two contract types
- `src/scripts/ensure-gitignore.ts` - the smallest complete handler: two args, no result
- `src/scripts/detect-changes.ts` - a handler whose returned object a later `if` reads
- `src/engine/primitives/script.ts` - the caller, and the whole of the arg/`set` contract

## Related Concepts

- [Flow Definitions](./flow-definitions.md)
- [Feature: Flow Execution](../features/flow-execution.md)
- [Adding Built-in Scripts](../patterns/adding-built-in-scripts.md)
- [Corpus Documents](./corpus-documents.md)
