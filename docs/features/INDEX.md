# Features Index

| Name | Description |
|------|-------------|
| [Agent Invocation](./agent-invocation.md) | How the system resolves a backend, constructs an agent, and invokes it with a rendered prompt |
| [Flow Execution](./flow-execution.md) | How `runFlow()` iterates steps, dispatches by type, renders agent prompts, runs scripts, evaluates predicates, and handles assertions |
| [Flow Loading and Validation](./flow-loading-and-validation.md) | How `loadFlow()` reads YAML, parses it, and validates the structure into typed `FlowDefinition` |
| [CLI Entry Point](./cli-entry-point.md) | How the five subcommands parse arguments, resolve the agent, create a run context, and execute flows |
| [Plan Parsing](./plan-parsing.md) | How `parse-plan` extracts YAML frontmatter phases from a plan file |
| [Change Detection](./change-detection.md) | How `detect-changes` compares the work tree against BASELINE and classifies differences |
| [Baseline Generation](./baseline-generation.md) | How `generate-baseline` creates the `docs/BASELINE` content manifest |
| [Init Workflow](./init-workflow.md) | End-to-end: architecture → plan → phase-0 slice → install-rules → foreach phase (slice + verify/fix) → baseline |
| [Install Rules](./install-rules.md) | Install always-on documentation rule stubs into an app directory; used standalone or as a step in the init workflow |
| [Update Workflow](./update-workflow.md) | End-to-end: detect changes → if changes exist: plan → foreach phase (slice + verify/fix) → regenerate baseline |
| [Quick-Update Workflow](./quick-update-workflow.md) | Fast single-session doc update using a cheaper model; produces a metadata artifact for later verification |
| [Verify Quick Updates Workflow](./verify-quick-updates-workflow.md) | Consolidate and harden unverified quick-update artifacts: plan → slice + verify/fix per phase → remove processed artifacts |
