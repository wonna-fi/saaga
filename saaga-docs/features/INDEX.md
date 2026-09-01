---
title: "Feature Index"
type: index
---

# Feature Index

| Name | Description |
|------|-------------|
| [CLI Entry Point](./cli-entry-point.md) | The `saaga` command surface — `run`, `install-rules` and `doctor`, their flags and exit codes, and the lifecycle of a flow run from cost approval to the last line printed. |
| [Corpus Gates](./corpus-gates.md) | The deterministic checks a documentation flow is bracketed by: the format-version gate that refuses an incompatible corpus, the budget gate that holds a plan to its ceilings, and the structural validation that fails a run whose output is broken. |
| [Doctor](./doctor.md) | The diagnostic that establishes whether a backend's CLI is installed, still accepts the flags Saaga passes it, and can do a flow's work — at a fast tier that makes no model calls and a full tier that probes a real agent in a throwaway repository. |
| [Eval Harness](./eval-harness.md) | The repo-only experiment measuring whether the documentation corpus helps a coding agent: pre-registered tasks run in isolated sandboxes under different documentation conditions, scored and reported per condition. |
| [Flow Execution](./flow-execution.md) | How the runner executes a flow: step dispatch, the agent- and script-step lifecycles, phase numbering, prompt archiving, and the step journal a resumed run reads. |
| [Init Workflow](./init-workflow.md) | The flow that documents a repository from scratch: architecture, a budgeted plan, then one write/verify/fix pass per slice, ending in a baseline and a validated corpus. |
| [Install Rules](./install-rules.md) | Writing the always-on "read the docs first" rule into a repository's own agent-rule files, between markers that leave the user's own content untouched. |
| [Navigation Generation](./navigation-generation.md) | How the corpus's `README.md` and `GLOSSARY.md` are derived from the category INDEX files, with every definition copied verbatim from the row that owns it. |
| [Quick-Update Workflows](./quick-update-workflows.md) | The cheap daily pass that records a change and leaves an artifact behind, and the batched pass that later verifies every artifact and deletes it. |
| [Update Workflow](./update-workflow.md) | The flow that re-documents only what changed since the baseline, planning one phase per change group and short-circuiting when nothing did. |
