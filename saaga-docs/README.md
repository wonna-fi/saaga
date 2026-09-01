---
title: saaga Documentation
type: index
---

# saaga Documentation

Generated navigation for this corpus. Saaga rewrites this file from the
INDEX files on every documentation run — edit the documents it links to, not
this page.

Read in order: the architecture, then the core concepts, then the workflows.

## Architecture

- [Architecture](./ARCHITECTURE.md)

## Core Concepts

The concepts the rest of the corpus links to most often. Everything else assumes them.

- [Script Registry](./concepts/script-registry.md) — The deterministic half of a flow: the id-to-handler map a `script:` step is dispatched through, and the contract between a step's arguments and a handler's return value.
- [Backend Resolution](./concepts/backend-resolution.md) — How a run decides which agent CLI it drives and which model stands behind each model key its flow asks for.
- [Agent Permissions](./concepts/agent-permissions.md) — The backend-neutral profile that says what a run lets the agent read, write, and run — and how each backend expresses it in its own CLI's permission syntax.
- [Agent Interface](./concepts/agent-interface.md) — The one-method boundary every coding-agent CLI is driven through: `run(prompt, opts)` spawning a subprocess and reporting an exit code.

## Workflows and Features

What the system does, end to end, in index order.

- [CLI Entry Point](./features/cli-entry-point.md) — The `saaga` command surface — `run`, `install-rules` and `doctor`, their flags and exit codes, and the lifecycle of a flow run from cost approval to the last line printed.
- [Corpus Gates](./features/corpus-gates.md) — The deterministic checks a documentation flow is bracketed by: the format-version gate that refuses an incompatible corpus, the budget gate that holds a plan to its ceilings, and the structural validation that fails a run whose output is broken.
- [Doctor](./features/doctor.md) — The diagnostic that establishes whether a backend's CLI is installed, still accepts the flags Saaga passes it, and can do a flow's work — at a fast tier that makes no model calls and a full tier that probes a real agent in a throwaway repository.
- [Eval Harness](./features/eval-harness.md) — The repo-only experiment measuring whether the documentation corpus helps a coding agent: pre-registered tasks run in isolated sandboxes under different documentation conditions, scored and reported per condition.
- [Flow Execution](./features/flow-execution.md) — How the runner executes a flow: step dispatch, the agent- and script-step lifecycles, phase numbering, prompt archiving, and the step journal a resumed run reads.
- [Init Workflow](./features/init-workflow.md) — The flow that documents a repository from scratch: architecture, a budgeted plan, then one write/verify/fix pass per slice, ending in a baseline and a validated corpus.
- [Install Rules](./features/install-rules.md) — Writing the always-on "read the docs first" rule into a repository's own agent-rule files, between markers that leave the user's own content untouched.
- [Navigation Generation](./features/navigation-generation.md) — How the corpus's `README.md` and `GLOSSARY.md` are derived from the category INDEX files, with every definition copied verbatim from the row that owns it.
- [Quick-Update Workflows](./features/quick-update-workflows.md) — The cheap daily pass that records a change and leaves an artifact behind, and the batched pass that later verifies every artifact and deletes it.
- [Update Workflow](./features/update-workflow.md) — The flow that re-documents only what changed since the baseline, planning one phase per change group and short-circuiting when nothing did.

## Indexes

- [Concept Index](./concepts/INDEX.md)
- [Pattern Index](./patterns/INDEX.md)
- [Convention Index](./conventions/INDEX.md)
- [Feature Index](./features/INDEX.md)
- [Glossary](./GLOSSARY.md) — every indexed term, with the definition its index gives it
