# Concepts Index

| Name | Description |
|------|-------------|
| [Agent Interface](./agent-interface.md) | The `Agent` interface, `AgentRunOpts`, `AgentRunResult`, and how backends implement the contract |
| [Templates and Prompt Rendering](./templates-and-prompt-rendering.md) | The `{var}` placeholder system, strict vs. lenient mode, `renderPrompt()` / `renderPromptFile()` |
| [Package Paths](./package-paths.md) | `PACKAGE_ROOT`, `FLOWS_DIR`, `PROMPTS_DIR`, `RULES_DIR` and how they resolve across `src/` and `dist/` |
| [Flow DSL](./flow-dsl.md) | The type system: `FlowDefinition`, `Step` discriminated union, and `Scope` |
| [Scope and Expressions](./scope-and-expressions.md) | The `${var}` interpolation system, path resolution, predicate evaluation, and `resolveValue()` |
| [Project Configuration](./project-configuration.md) | The `.saaga/config.yaml` file: fields, loading, validation, and resolution chains |
| [Backend Resolution](./backend-resolution.md) | The precedence chain for selecting a backend and resolving models via open model keys |
| [Cost Confirmation](./cost-confirmation.md) | The interactive cost disclaimer shown before agent-backed commands: notice builder, auto-approve, and `ConfirmationDeclinedError` |
| [Run Context and Isolation](./run-context.md) | Run ID format, `<appPath>/.saaga-runs/` directory layout, and run context creation for artifact isolation |
| [Script Registry](./script-registry.md) | The `ScriptRegistry` map, `ScriptHandler` signature, `ScriptContext`, and how built-in scripts are registered and invoked |
| [Baseline and Change Detection](./baseline-and-change-detection.md) | The `<docs_dir>/BASELINE` file format, `.saagaignore` filtering, and change classification system |
| [Flow Definitions](./flow-definitions.md) | The four flow YAML files, their step sequences, and how they compose agent steps, scripts, and control flow |
| [Output and Progress Display](./output-and-progress.md) | `OutputSink`, `PhaseTracker`, `Marker` type, `formatDuration()`, TTY spinner, column-aligned markers, log-file capture, and `--verbose` mode |
| [Prompt Templates](./prompt-templates.md) | The eight prompt template files, their `{var}` placeholders, and their role in each workflow |
| [Agent Permissions and Restriction](./agent-permissions.md) | `AgentPermissions` interface, `buildProfile()`, `enumerateExcludedPaths()`, `ALLOWED_SHELL_COMMANDS`, and how backends translate the profile |
| [Agent Events and Denial Parsing](./agent-events.md) | `AgentEvent` union, `EventParser`, `LineSplitter`, `consumeEvents()`, per-backend parsers, `PermissionAuditor`, and `classifyDenial()` |
| [Saaga Rules](./saaga-rules.md) | `.saagarules` project instructions: load/validate, append to agent prompts, baseline exclusion, and permission deny |
| [Unstable Features](./unstable-features.md) | Opt-in experimental feature registry: `UNSTABLE_FEATURES`, config/`--unstable-feature` resolution, and process-wide enablement |
