---
title: Flow Definitions
type: concept
sources:
  - src/engine/loader.ts
  - src/engine/types.ts
  - src/paths.ts
  - flows/init.flow.yaml
terms:
  - flow
  - flow file
  - step
  - primitive
---

# Flow Definitions

## Business Definition

A **flow** is a documentation workflow written as data: a YAML file naming a sequence of
steps that alternate between asking an agent to write something and running deterministic
code over the result. The flow file is the whole of the workflow — there is no per-workflow
TypeScript — so changing what `saaga run init` does means editing
`flows/init.flow.yaml` and the prompts it names.

A **step** is one object carrying exactly one **primitive** key. Six primitives exist:
`agent` and `script` are the two leaves that do work, `foreach`, `loop` and `if` are
control flow, and `read-file` is the plumbing that gets a file's contents into scope.

## Configuration

| Source | Description |
|--------|-------------|
| `<package root>/flows/<name>.flow.yaml` | Every bundled flow; the directory is the only place flows are searched for |

A flow is addressed by the filename stem, which is what `saaga run <name>` takes and what
the `name:` field inside the file is expected to repeat — see
[file layout](../conventions/file-layout.md). `description:` is the text `saaga run` with
no flow prints beside each name, so a bundled flow is expected to carry one.

**How to access:**
- `loadFlow(name)` - parses `<name>.flow.yaml` from the flows directory
- `loadFlowFromFile(path)` - parses a flow at an arbitrary path
- `listFlows()` - every `*.flow.yaml` in the directory, as name and description, sorted by name
- `flowExists(name)` (predicate) - whether the file is there, without parsing it
- `FLOWS_DIR` (constant, `src/paths.ts`) - the directory itself, resolved relative to the
  installed package rather than the user's project

## Data Storage

| Type | Fields | Purpose |
|--------|-------|---------|
| `FlowDefinition` | `name`, `description?`, `steps` | The parsed flow file |
| `AgentStep` | `prompt`, `vars?`, `expect_file?`, `model?`, `label?` | Run a prompt template against the agent |
| `ScriptStep` | `name`, `args`, `set?`, `label?` | Run a built-in script; every key that is not `name`/`set`/`label` becomes an entry in `args` |
| `ForeachStep` | `var`, `in`, `do`, `when?`, `label?` | Bind each item of an array to `var` and run `do` |
| `LoopStep` | `max`, `until`, `do`, `label?` | Repeat `do` until the predicate holds or `max` is reached |
| `IfStep` | `condition`, `then`, `label?`, `skip_label?` | Run `then` when the predicate holds |
| `ReadFileStep` | `path`, `set`, `trim?`, `label?` | Bind a file's contents to a scope variable |

`label` is the human-readable name of the step in terminal output; `skip_label` is the
reason shown when an `if` is not taken. Both are interpolated, as is every field marked as
an expression — see [scope and expressions](./scope-and-expressions.md) for the syntax.
`agent.prompt` names a [prompt template](./prompt-templates.md), `agent.model` a model key
resolved through [backend resolution](./backend-resolution.md), and `script.name` an entry
in the [script registry](./script-registry.md).

The `if` primitive is the one step that is not a single key: it is written as `if:` and
`then:` siblings, optionally with `label:` and `skip_label:`, because a nested body under a
single `if:` key reads worse in YAML. There is no `else`; a flow that needs one chains a
second `if` with the negated predicate.

`foreach` over a parsed plan and a bounded `loop` are the two structures every bundled flow
is built from:

```yaml
- foreach:
    var: phase
    in: ${phases}
    when: '${phase.number} != 0'
    do:
      - agent:
          prompt: slice-doc
          label: documenting "${phase.title}"
          vars:
            phase_number: ${phase.number}

- loop:
    max: 3
    until: '${status} == "PASS"'
    do:
      - agent: { prompt: verify-domain-documentation, model: high }
      - read-file: { path: ${status_path}, set: status, trim: true }
      - if: '${status} != "PASS"'
        then:
          - agent: { prompt: fix-documentation }
```

## Key Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `engine/loader` | `loadFlow()` | Load a bundled flow by name |
| `engine/loader` | `loadFlowFromFile()` | Load and parse a flow file by path |
| `engine/loader` | `parseFlowDefinition()` | Validate raw YAML into a `FlowDefinition` |
| `engine/loader` | `listFlows()` | Name and description of every bundled flow |
| `engine/loader` | `flowExists()` | Whether a named flow file exists |
| `engine/loader` | `agentSteps()` | Every agent step in a step list, descending into `do`/`then` bodies, in document order |
| `engine/loader` | `FlowInfo` | `name` and optional `description`, as returned by `listFlows()` |
| `engine/types` | `FlowDefinition`, `Step`, `Scope` | The parsed shapes; `Step` is the union of the six primitives |

`agentSteps()` is how the CLI learns which model keys a flow will ask for before the run
starts. It is deliberately not the same traversal as the phase counter's, which stops at a
loop or foreach container rather than descending into it.

### Validation

`parseFlowDefinition()` is the whole of flow validation: a file that survives it is a
`FlowDefinition`, and a file that does not throws an `Error` naming the offending key —
see [error messages](../conventions/error-messages.md) for the phrasing. The rules are:

- The document is an object with a string `name`, an optional string `description`, and an
  array `steps`.
- Every step is a non-array object with exactly one primitive key, or the `if`/`then` pair.
  An unrecognised key is rejected as an unknown step type rather than ignored.
- Each primitive's body is an object, and each field has the type in the table above:
  `loop.max` must be a positive integer, `foreach.in` and every predicate a string,
  `read-file.trim` a boolean.
- An `agent` step accepts only `prompt`, `vars`, `expect_file`, `label` and `model`. A
  mistyped key is a hard error, because a silently ignored `model` would run the whole
  flow on the wrong model with no signal. `model` must additionally match the model-key
  pattern.
- `script` args and `agent.vars` values are coerced to strings, with `null` becoming `""`.

What validation deliberately does *not* check is whether the things a step names exist: an
unknown `script.name` and a missing `agent.prompt` template both fail when the step runs,
not when the flow loads. A flow whose steps are all valid can still fail on its first step.

## Reference Implementations

- `src/engine/loader.ts` - the parser and every validation rule
- `flows/init.flow.yaml` - the worked example: all six primitives, nested two deep
- `tests/engine/loader.test.ts` - the validation contract, key by key
- `tests/flows.test.ts` - the bundled flows checked as data, without running them

## Related Concepts

- [Scope and Expressions](./scope-and-expressions.md)
- [Prompt Templates](./prompt-templates.md)
- [Script Registry](./script-registry.md)
- [Feature: Flow Execution](../features/flow-execution.md)
- [File Layout](../conventions/file-layout.md)
