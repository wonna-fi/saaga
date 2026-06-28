# Developing Saaga

This document covers building, testing, and extending Saaga itself. For
using Saaga on your own projects, see [README.md](./README.md).

## Getting started

```bash
git clone <repo-url>
cd saaga
pnpm install
pnpm build          # tsc → dist/
```

The compiled CLI lives at `dist/cli.js` and is exposed as the `saaga`
bin (see `package.json`).

During development, run directly from source without building:

```bash
pnpm dev <subcommand> [args]
```

## Running tests

```bash
pnpm test           # vitest run
pnpm test:watch     # vitest watch
```

## Repository layout

| Directory | Contents |
| --------- | -------- |
| `src/` | TypeScript source — CLI, engine, agents, scripts |
| `flows/` | Flow YAML files (one per subcommand) |
| `prompts/` | Prompt templates with `{var}` placeholders |
| `rules/` | Rule stub templates installed by `install-rules` |
| `docs/` | Domain documentation (concepts, features, patterns) |
| `examples/` | Dockerfile, agent install scripts |
| `.devcontainer/` | Dev container configuration |

## Domain documentation

The `docs/` directory contains the authoritative source for
understanding the system. **Always read the domain documentation before
exploring source code.**

- [Concepts](./docs/concepts/INDEX.md) — what something is and where
  it lives (agent interface, flow DSL, scope, templates, configuration).
- [Features](./docs/features/INDEX.md) — end-to-end feature
  specifications (init workflow, update workflow, verify/fix loop).
- [Patterns](./docs/patterns/INDEX.md) — how to do common operations
  (adding backends, adding flow primitives, creating prompts).

## Extending Saaga

The domain docs include step-by-step patterns for common extensions:

- [Adding agent backends](./docs/patterns/adding-agent-backends.md)
- [Adding CLI subcommands](./docs/patterns/adding-cli-subcommands.md)
- [Adding flow primitives](./docs/patterns/adding-flow-primitives.md)
- [Adding built-in scripts](./docs/patterns/adding-built-in-scripts.md)
- [Creating prompt templates](./docs/patterns/creating-prompt-templates.md)
- [Writing flow YAML files](./docs/patterns/writing-flow-yaml-files.md)
- [Testing with FakeAgent](./docs/patterns/testing-with-fake-agent.md)
- [Customizing the verify/fix loop](./docs/patterns/customizing-verify-fix-loop.md)

## Flows and prompts

The orchestration logic ships as YAML, not code. Each subcommand maps to
a flow file:

- [`flows/architecture.flow.yaml`](./flows/architecture.flow.yaml)
- [`flows/init.flow.yaml`](./flows/init.flow.yaml)
- [`flows/update.flow.yaml`](./flows/update.flow.yaml)
- [`flows/quick-update.flow.yaml`](./flows/quick-update.flow.yaml)
- [`flows/verify-quick-updates.flow.yaml`](./flows/verify-quick-updates.flow.yaml)
- [`flows/slice.flow.yaml`](./flows/slice.flow.yaml)

Edit them to add steps, swap prompts, adjust the verify/fix iteration
cap, or wire in your own scripts. The DSL primitives are `agent`,
`script`, `loop`, `foreach`, `if`, `commit`, and `read-file`.

Prompt templates live in [`prompts/`](./prompts) and use `{var}`
placeholders filled from the flow YAML's `vars:` block.

> Note: customizing flows currently requires editing files in the Saaga
> repository itself. First-class support for customizing flows from your
> own project, without modifying Saaga's source, is planned.

## Devcontainer

A Node-only dev container ships under
[`.devcontainer/`](./.devcontainer/). Agent CLIs are installed via the
`postCreateCommand` hook (`install-agents.sh`), which is shipped empty.
Populate it from the helpers under
[`examples/install-agents/`](./examples/install-agents/) to match the
backends you want available during development.

To build a self-contained image, see
[`examples/Dockerfile`](./examples/Dockerfile).
