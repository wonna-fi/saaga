## Documentation

### Domain Documentation

This application has structured domain documentation organized into three types:

- **Concepts** (`docs/concepts/INDEX.md`) — Domain concepts: what something is and where it lives (agent interface, flow DSL types, expression evaluation, scope, templates)
- **Patterns** (`docs/patterns/INDEX.md`) — Implementation patterns: how to do common operations (adding agent backends, adding flow primitives, adding built-in scripts, creating prompt templates)
- **Features** (`docs/features/INDEX.md`) — Feature specifications: end-to-end feature documentation (init workflow, update workflow, slice workflow, verify/fix loop)

#### When to Use Each Type

| If you need to understand... | Read a... | Example |
|------------------------------|-----------|---------|
| What "scope" means and how data flows between steps | Concept | `docs/concepts/scope-and-expressions.md` |
| How to add a new agent backend | Pattern | `docs/patterns/adding-agent-backends.md` |
| How the `init` command works end-to-end | Feature | `docs/features/init-workflow.md` |

#### Behavioral Rules

- **Docs first**: When working on `rewrite`, ALWAYS read the domain documentation BEFORE exploring source code. The domain documentation is the authoritative source for understanding the system. Source code is the second resort, used only when the docs do not cover the question.

- **No documentation updates during implementation**: Do NOT update domain documentation (concepts, patterns, features) when making code changes. Documentation updates are handled separately by Saaga to ensure quality and consistency. Focus your work on the code changes only.

- **Consult before implementing**: Before implementing new features or changes, check the existing concepts and patterns to understand and reuse existing services/modules. Avoid reinventing functionality that already exists.
