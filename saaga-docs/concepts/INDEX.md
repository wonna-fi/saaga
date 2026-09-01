---
title: "Concept Index"
type: index
---

# Concept Index

| Name | Description |
|------|-------------|
| [Agent Events](./agent-events.md) | The normalized facts parsed out of a backend's JSON output while it runs — refused tool calls, the session's toolset, its usage totals — and the classes a refusal is filed under. |
| [Agent Interface](./agent-interface.md) | The one-method boundary every coding-agent CLI is driven through: `run(prompt, opts)` spawning a subprocess and reporting an exit code. |
| [Agent Permissions](./agent-permissions.md) | The backend-neutral profile that says what a run lets the agent read, write, and run — and how each backend expresses it in its own CLI's permission syntax. |
| [Backend Resolution](./backend-resolution.md) | How a run decides which agent CLI it drives and which model stands behind each model key its flow asks for. |
| [Baseline and Change Detection](./baseline-and-change-detection.md) | The manifest of every file a corpus was documented from, the ignore rules that decide what is in scope, and the four categories a later run files each difference under. |
| [Corpus Budget](./corpus-budget.md) | The two ceilings a documentation plan is held to — how many documents and how many lines — derived from the repository's own source rather than from the plan. |
| [Corpus Documents](./corpus-documents.md) | What a document in the corpus is: its frontmatter, its category, its place in the link graph, and the structural rules it must satisfy. |
| [Flow Definitions](./flow-definitions.md) | A documentation workflow written as data: a YAML file of steps, the six primitives a step may be, and the validation that decides whether it loads. |
| [Project Configuration](./project-configuration.md) | Everything a repository can say about how Saaga treats it: `.saaga/config.yaml`, `.saagarules`, and the unstable-feature registry. |
| [Prompt Templates](./prompt-templates.md) | The Markdown files an agent step is rendered from: placeholders the flow fills in, shared partials pulled in by include directives, and the project rules appended last. |
| [Run Context](./run-context.md) | One invocation of a flow, given a run id, a `.saaga-runs/<run-id>/` directory, and a manifest a later invocation can resume from. |
| [Scope and Expressions](./scope-and-expressions.md) | The bag of named values a running flow reads and writes, and the small `${…}` language — paths, interpolation, one-comparison predicates — that reads it. |
| [Script Registry](./script-registry.md) | The deterministic half of a flow: the id-to-handler map a `script:` step is dispatched through, and the contract between a step's arguments and a handler's return value. |
