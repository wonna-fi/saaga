# Patterns Index

| Name | Description |
|------|-------------|
| [Adding Agent Backends](./adding-agent-backends.md) | Step-by-step pattern for implementing a new `Agent` and registering it in `cli/backend.ts` |
| [Creating Prompt Templates](./creating-prompt-templates.md) | How to write a `prompts/*.md` file with `{var}` placeholders and wire it into a flow |
| [Adding Flow Primitives](./adding-flow-primitives.md) | How to add a new step type: define the type, add a parser, implement the handler, register in the runner |
| [Writing Flow YAML Files](./writing-flow-yaml-files.md) | How to compose steps, use variable interpolation, and leverage control flow primitives |
| [Adding CLI Subcommands](./adding-cli-subcommands.md) | How to add a new subcommand: define it in `cli.ts`, create a flow, wire the handler |
| [Testing with FakeAgent](./testing-with-fake-agent.md) | How to use `FakeAgent` with substring-matched scenarios and side effects for integration tests |
| [Adding Built-in Scripts](./adding-built-in-scripts.md) | How to create a new script handler, register it in `defaultScriptRegistry`, and reference it from flow YAML |
| [Using .saagaignore](./using-saagaignore.md) | How to exclude paths from documentation scope using gitignore-syntax patterns |
| [Extending Workflows](./extending-workflows.md) | How to add steps, swap prompts, adjust iteration caps, or wire in custom scripts by editing flow YAML |
| [Customizing the Verify/Fix Loop](./customizing-verify-fix-loop.md) | How the `loop` + `read-file` + `if` pattern implements quality verification and how to adjust it |
