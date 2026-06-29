# Concepts Index

| Name | Description |
|------|-------------|
| [Agent Interface](./agent-interface.md) | The `Agent` interface, `AgentRunOpts`, `AgentRunResult`, and how backends implement the contract |
| [Templates and Prompt Rendering](./templates-and-prompt-rendering.md) | The `{var}` placeholder system, strict vs. lenient mode, `renderPrompt()` / `renderPromptFile()` |
| [Package Paths](./package-paths.md) | `PACKAGE_ROOT`, `FLOWS_DIR`, `PROMPTS_DIR`, `RULES_DIR` and how they resolve across `src/` and `dist/` |
| [Flow DSL](./flow-dsl.md) | The type system: `FlowDefinition`, `Step` discriminated union, and `Scope` |
| [Scope and Expressions](./scope-and-expressions.md) | The `${var}` interpolation system, path resolution, predicate evaluation, and `resolveValue()` |
| [Project Configuration](./project-configuration.md) | The `.saaga/config.yaml` file: fields, loading, validation, and resolution chains |
| [Backend Resolution](./backend-resolution.md) | The precedence chain for selecting a backend and model defaults |
| [Run Context and Isolation](./run-context.md) | Run ID format, `SAAGA_DIR` resolution, and run directory creation for artifact isolation |
| [Script Registry](./script-registry.md) | The `ScriptRegistry` map, `ScriptHandler` signature, `ScriptContext`, and how built-in scripts are registered and invoked |
| [Baseline and Change Detection](./baseline-and-change-detection.md) | The `docs/BASELINE` file format, `.saagaignore` filtering, and change classification system |
| [Flow Definitions](./flow-definitions.md) | The four flow YAML files, their step sequences, and how they compose agent steps, scripts, and control flow |
| [Prompt Templates](./prompt-templates.md) | The eight prompt template files, their `{var}` placeholders, and their role in each workflow |
