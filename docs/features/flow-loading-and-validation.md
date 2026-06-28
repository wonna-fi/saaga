# Feature: Flow Loading and Validation

## Overview

Flow loading reads a YAML file from disk, parses it into a JavaScript object, and validates it into a typed `FlowDefinition` structure. The process ensures that every flow step is well-formed before execution begins, catching structural errors early with descriptive error messages.

## Key Concepts

Before working with this feature, understand these concepts:

- [Flow DSL](../concepts/flow-dsl.md)
- [Package Paths](../concepts/package-paths.md)

## Functional Specification

### User Flow

1. CLI subcommand determines which flow to run (e.g. `"init"`, `"update"`, `"quick-update"`)
2. Calls `loadFlow(name)` which resolves the path: `<FLOWS_DIR>/<name>.flow.yaml`
3. Reads the file contents as UTF-8
4. Parses YAML into a raw JavaScript object using the `yaml` package
5. Validates structure via `parseFlowDefinition()` which recursively parses all steps
6. Returns a typed `FlowDefinition` ready for execution by `runFlow()`

### Loading Entry Points

| Function | Input | Resolution |
|----------|-------|------------|
| `loadFlow(name)` | Flow name (e.g. `"init"`) | Resolves to `<FLOWS_DIR>/<name>.flow.yaml` |
| `loadFlowFromFile(path)` | Absolute file path | Uses the path directly |
| `parseFlowDefinition(raw)` | Pre-parsed YAML object | No file I/O — pure validation |

### Validation Rules

#### Top-Level Structure

| Field | Validation | Error on Failure |
|-------|------------|------------------|
| root | Must be a non-null object | `"Flow definition must be an object"` |
| `name` | Must be a string | `"Flow 'name' must be a string"` |
| `steps` | Must be an array | `"Flow 'steps' must be an array"` |

#### Step Parsing

Each element in `steps` is validated by `parseStep()`:

| Condition | Error |
|-----------|-------|
| Not an object or is an array | `"Step must be an object with one primitive key"` |
| Has 2 keys that are `if` + `then` | Parsed as `IfStep` (special case) |
| Does not have exactly 1 key | `"Step must have exactly one primitive key (got N: key1, key2, ...)"` |
| Key is not a recognized step type | `"Unknown step type: '<key>'"` |

#### Agent Step Validation

| Field | Validation | Error |
|-------|------------|-------|
| body | Must be a non-null, non-array object | `"'agent' step body must be an object"` |
| `prompt` | Must be a string | `"'agent.prompt' must be a string (template name)"` |
| `vars` | If present, must be a non-null, non-array object | `"'agent.vars' must be an object"` |
| `expect_file` | If present, must be a string | `"'agent.expect_file' must be a string"` |

#### Script Step Validation

| Field | Validation | Error |
|-------|------------|-------|
| body | Must be a non-null, non-array object | `"'script' step body must be an object"` |
| `name` | Must be a string | `"'script.name' must be a string"` |
| `set` | If present, must be a string | `"'script.set' must be a string"` |
| Other keys | Collected as `args`, coerced to strings (null → `""`) | — |

#### Foreach Step Validation

| Field | Validation | Error |
|-------|------------|-------|
| body | Must be a non-null, non-array object | `"'foreach' step body must be an object"` |
| `var` | Must be a string | `"'foreach.var' must be a string"` |
| `in` | Must be a string | `"'foreach.in' must be an expression string"` |
| `do` | Must be an array | `"'foreach.do' must be an array of steps"` |
| `when` | If present, must be a string | `"'foreach.when' must be a string predicate"` |
| `do` items | Recursively validated via `parseStep()` | — |

#### Loop Step Validation

| Field | Validation | Error |
|-------|------------|-------|
| body | Must be a non-null, non-array object | `"'loop' step body must be an object"` |
| `max` | Must be a positive integer | `"'loop.max' must be a positive integer"` |
| `until` | Must be a string | `"'loop.until' must be a string predicate"` |
| `do` | Must be an array | `"'loop.do' must be an array of steps"` |
| `do` items | Recursively validated via `parseStep()` | — |

#### If Step Validation

| Field | Validation | Error |
|-------|------------|-------|
| `if` | Must be a string | `"'if' must be a string predicate"` |
| `then` | Must be an array | `"'then' must be an array of steps"` |
| `then` items | Recursively validated via `parseStep()` | — |

#### Read-File Step Validation

| Field | Validation | Error |
|-------|------------|-------|
| body | Must be a non-null, non-array object | `"'read-file' step body must be an object"` |
| `path` | Must be a string | `"'read-file.path' must be a string"` |
| `set` | Must be a string | `"'read-file.set' must be a string (variable name)"` |
| `trim` | If present, must be a boolean | `"'read-file.trim' must be a boolean"` |

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| YAML file does not exist | `readFile()` throws ENOENT (Node.js filesystem error) |
| YAML is syntactically invalid | `yaml.parse()` throws a YAML parse error |
| YAML parses to `null` (empty file) | `parseFlowDefinition()` throws `"Flow definition must be an object"` |
| Nested steps in `foreach.do` / `loop.do` / `if.then` are invalid | Recursive `parseStep()` throws with the specific validation error |
| `vars` values are `null` | Coerced to empty string `""` |
| `args` values are `null` | Coerced to empty string `""` |

## Technical Implementation

### Flow File Format

```yaml
name: example
steps:
  - agent:
      prompt: template-name
      vars:
        key: ${scope_var}
      expect_file: ${output_path}
  - script:
      name: script-name
      arg1: value1
      set: result_var
```

### Services/Functions

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/engine/loader.ts` | `loadFlow()` | Loads a flow by name from `FLOWS_DIR` |
| `src/engine/loader.ts` | `loadFlowFromFile()` | Loads a flow from an arbitrary absolute path |
| `src/engine/loader.ts` | `parseFlowDefinition()` | Validates a raw object into a typed `FlowDefinition` |

### Internal Implementation

| Function | Purpose |
|----------|---------|
| `parseStep()` | Dispatches to type-specific parsers based on the step's top-level key |
| `parseAgentStep()` | Validates and constructs an `AgentStep` |
| `parseScriptStep()` | Validates and constructs a `ScriptStep`; collects non-reserved keys as args |
| `parseForeachStep()` | Validates and constructs a `ForeachStep`; recursively parses `do` body |
| `parseLoopStep()` | Validates and constructs a `LoopStep`; recursively parses `do` body |
| `parseIfStep()` | Validates and constructs an `IfStep`; recursively parses `then` body |
| `parseReadFileStep()` | Validates and constructs a `ReadFileStep` |

### Dependencies

- `node:fs/promises` — `readFile()` for reading YAML from disk
- `node:path` — `resolve()` for constructing absolute paths
- `yaml` (npm package) — `parse()` for YAML → JavaScript object deserialization
- `src/paths.ts` — `FLOWS_DIR` constant for the default flow directory

## Integration Points

- **Depends on**: `FLOWS_DIR` from `src/paths.ts`, `yaml` npm package
- **Used by**: CLI subcommands call `loadFlow()` before passing the result to `runFlow()`; tests use `loadFlowFromFile()` or `parseFlowDefinition()` directly
- **Produces**: A typed `FlowDefinition` consumed by the flow runner

## Extension Guide

- **Add a new step type**: Add a new `case` in `parseStep()`'s switch statement, implement a `parse<Type>Step()` function with full validation. See [Adding Flow Primitives](../patterns/adding-flow-primitives.md).
- **Load flows from non-default locations**: Use `loadFlowFromFile(absolutePath)` instead of `loadFlow(name)`
- **Validate without file I/O**: Use `parseFlowDefinition(raw)` with a pre-parsed YAML object (useful in tests)
- **Add optional fields to existing steps**: Add a guarded `if (obj.field !== undefined)` block after the required field checks, validate the type, and conditionally assign to the result object
