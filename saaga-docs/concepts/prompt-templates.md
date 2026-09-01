---
title: Prompt Templates
type: concept
sources:
  - src/templates.ts
  - src/paths.ts
  - src/saaga-rules.ts
  - src/engine/runner.ts
terms:
  - partial
  - include directive
  - placeholder
---

# Prompt Templates

## Business Definition

A **prompt template** is the Markdown file an `agent` step names: the instructions the
coding agent is given, with `{placeholder}` holes the flow fills in and
`{include:…}` directives that pull in shared fragments. Templates are the product's
actual content — the documentation methodology lives in them, not in TypeScript — so they
are versioned, rendered and archived like any other artifact.

A **partial** is a template fragment that exists to be included rather than run. The
document templates, level-of-detail policy, single-home rule and quality checklists this
corpus was written against are all partials.

## Configuration

| Source | Description |
|--------|-------------|
| `<package root>/prompts/<name>.md` | A top-level template; `agent.prompt: <name>` resolves here |
| `<package root>/prompts/partials/<name>.md` | A shared fragment, reached only through `{include:partials/<name>.md}` |

**How to access:**
- `renderPromptFile(path, vars, options)` - read a template, expand its includes, substitute its variables
- `renderPrompt(template, vars, options)` - substitution only, over a string already in hand
- `resolveIncludes(template, { selfDir, roots })` - include expansion only
- `PROMPTS_DIR` (constant, `src/paths.ts`) - the templates directory, resolved relative to the installed package

The directory is package-relative, so a template ships with the release rather than living
in the repository being documented. `includeRoots` is a list rather than a single root
precisely so a project's own prompt directory could be prepended later; today the runner
passes `[PROMPTS_DIR]`.

## Data Storage

| Artifact | Field/Property | Purpose |
|--------|-------|---------|
| `prompts/*.md` | file body | The rendered-from text of one agent step |
| `prompts/partials/*.md` | file body | A fragment several templates include |
| `<runDir>/prompts/NN-*.md` | file body | The rendered result, archived per step by [flow execution](../features/flow-execution.md) |

### Rendering

**Variables.** `{key}` is replaced by `vars[key]`, every occurrence, with the value
inserted literally. A placeholder with no matching variable is **left intact** — the
document templates use `{Type}`, `{ModuleName}` and the like as literal documentation, and
escaping all of them would be worse than leniency. `strict: true` opts in to throwing
`MissingTemplateVariableError` instead, and is used by the renderer's own unit tests
rather than by the engine. The compensating guard for real prompts is in
`tests/flows.test.ts`: it renders every bundled flow's agent steps and fails if any
flow-supplied placeholder survives.

**Includes.** `{include:partials/lod-policy.md}` splices in another file, recursively. The
colon and slashes make the directive unmatchable by the placeholder pattern, so the two
mechanisms cannot collide, and includes are expanded *before* substitution — which means a
placeholder inside a partial still resolves, while a variable whose value happens to
contain `{include:` never does. One trailing newline is dropped from each expansion so a
directive on its own line does not introduce a blank line.

**Containment.** A spec is resolved against the including file's own directory first, then
each configured root in order, and the first file that exists wins. Include specs come
from template *content*, so a spec that escapes a root is skipped for that root rather than
followed: an absolute path, or one that climbs out of every root with `..`, is rejected
with `IncludeOutsideRootError`, which is what keeps the directive from becoming an
arbitrary-file-read primitive. A contained spec that matches no file raises
`TemplateFileNotFoundError` naming the roots tried.

A file that appears twice in the current include chain raises `CircularIncludeError`; so
does a chain deeper than 10.

**Project rules.** After a template is rendered, `appendSaagaRules()` appends the
[`.saagarules`](./project-configuration.md) text under a `## Additional project-specific
documentation instructions` heading with a bounded-priority preamble — high priority, but
explicitly below output formats, file paths, workflow control and permission constraints.
That append is the last thing to touch a prompt before the agent receives it.

## Key Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `templates` | `renderPromptFile()` | The whole pipeline: read, expand includes, substitute |
| `templates` | `renderPrompt()` | Placeholder substitution over a string |
| `templates` | `resolveIncludes()` | Include expansion over a string |
| `templates` | `RenderPromptOptions` | `strict`, `includeRoots` |
| `templates` | `MissingTemplateVariableError`, `TemplateFileNotFoundError`, `IncludeOutsideRootError`, `CircularIncludeError` | The four failures rendering can raise |

The renderer knows nothing about prompts specifically — it takes a path and a root list —
which is why [install-rules](../features/install-rules.md) reuses it to render the rule
files it writes into a repository.

## Reference Implementations

- `src/templates.ts` - substitution, include resolution, containment and cycle checks
- `prompts/slice-doc.md` - a top-level template assembled almost entirely from partials
- `prompts/partials/document-templates.md` - a partial that itself includes five more
- `tests/templates.test.ts` - the rendering contract, including the escape attempts
- `tests/prompts.test.ts` - the bundled templates' content, and which partial reaches which prompt

## Related Concepts

- [Flow Definitions](./flow-definitions.md)
- [Project Configuration](./project-configuration.md)
- [Feature: Flow Execution](../features/flow-execution.md)
- [Extending Workflows](../patterns/extending-workflows.md)
