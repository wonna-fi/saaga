# Flow DSL

## Business Definition

The Flow DSL is the type system that defines how Saaga workflows are structured. A flow is a named sequence of steps, where each step is one of six primitives: `agent`, `script`, `foreach`, `loop`, `if`, or `read-file`. Flows are authored as YAML files and loaded into typed TypeScript structures for execution by the flow engine.

## Configuration

| Source | Description |
|--------|-------------|
| `flows/*.flow.yaml` files | YAML flow definitions stored in the `flows/` directory |
| `FLOWS_DIR` constant (`src/paths.ts`) | Resolves to `<PACKAGE_ROOT>/flows` — the directory where flow YAML files live |
| `FlowDefinition` type (`src/engine/types.ts`) | The typed in-memory representation of a parsed flow |

**How to access:**

- `loadFlow(name)` — loads a flow by name from `FLOWS_DIR` (appends `.flow.yaml`)
- `loadFlowFromFile(path)` — loads a flow from an arbitrary file path
- `parseFlowDefinition(raw)` — parses an already-deserialized YAML object into a typed `FlowDefinition`
- `listFlows()` — returns all bundled flows as `FlowInfo[]` (name + optional description), sorted by name
- `flowExists(name)` — returns whether `flows/<name>.flow.yaml` exists

## Data Storage

### FlowDefinition

| Type | Field/Property | Purpose |
|------|----------------|---------|
| `FlowDefinition` | `name` | Human-readable identifier for the flow (e.g. `"init"`, `"update"`) |
| `FlowDefinition` | `description` | Optional short summary shown when listing flows via `saaga run` with no flow name |
| `FlowDefinition` | `steps` | Ordered array of `Step` values to execute sequentially |

### Step (Discriminated Union)

The `Step` type is a union discriminated on the `type` field:

| Type | `type` value | Purpose |
|------|--------------|---------|
| `AgentStep` | `"agent"` | Invokes an AI agent with a rendered prompt template |
| `ScriptStep` | `"script"` | Runs a built-in script function |
| `ForeachStep` | `"foreach"` | Iterates over an array, executing child steps per item |
| `LoopStep` | `"loop"` | Repeats child steps until a predicate is true or `max` is reached |
| `IfStep` | `"if"` | Conditionally executes child steps based on a predicate |
| `ReadFileStep` | `"read-file"` | Reads a file's contents into a scope variable |

### AgentStep Fields

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `prompt` | `string` | Yes | Name of the prompt template file (without `.md` extension) |
| `vars` | `Record<string, string>` | No | Variables to pass to the template, values may contain `${expr}` expressions |
| `expect_file` | `string` | No | Path (may contain `${expr}`) that must exist after the agent finishes |
| `label` | `string` | No | Human-readable label for progress display; interpolated against scope (e.g. `documenting "${phase.title}"`) |

### ScriptStep Fields

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `name` | `string` | Yes | Registered name of the built-in script to invoke |
| `args` | `Record<string, string>` | Yes | Arguments passed to the script handler (all non-reserved keys become args) |
| `set` | `string` | No | Scope variable name to store the script's return value |
| `label` | `string` | No | Human-readable label for progress display; interpolated against scope |

### ForeachStep Fields

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `var` | `string` | Yes | Loop variable name bound to the current item |
| `in` | `string` | Yes | Expression (e.g. `${phases}`) that must resolve to an array |
| `when` | `string` | No | Predicate to filter items; iterations where it evaluates false are skipped |
| `do` | `Step[]` | Yes | Child steps to execute for each (non-filtered) item |
| `label` | `string` | No | Human-readable label for progress display; interpolated against scope |

### LoopStep Fields

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `max` | `number` | Yes | Maximum iterations (positive integer); hard cap preventing infinite loops |
| `until` | `string` | Yes | Predicate evaluated after each iteration; loop exits when true |
| `do` | `Step[]` | Yes | Child steps to execute each iteration |
| `label` | `string` | No | Human-readable label for progress display; interpolated against scope |

### IfStep Fields

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `condition` | `string` | Yes | Predicate expression; body executes only when true |
| `then` | `Step[]` | Yes | Child steps to execute when condition is true |
| `label` | `string` | No | Human-readable label for progress display (used in the `[SKIP]` line when the condition is false) |
| `skip_label` | `string` | No | Reason shown in parentheses on the `[SKIP]` line when the condition is false; interpolated against scope (e.g. `no changes detected`) |

### ReadFileStep Fields

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `path` | `string` | Yes | File path to read (supports `${expr}` interpolation) |
| `set` | `string` | Yes | Scope variable name to store the file contents |
| `trim` | `boolean` | No | When `true`, trims whitespace from the file contents |
| `label` | `string` | No | Human-readable label for progress display; interpolated against scope |

> **Note:** The `label` field is present on all step types and is used by the [Output and Progress Display](./output-and-progress.md) system for the `Phase N/M: label` progress lines. Labels support `${expr}` interpolation against the flow scope. When no label is provided, the runner derives one from the step name (replacing hyphens with spaces). The `skip_label` field is unique to `IfStep` and provides an explanation appended to the `[SKIP]` phase line.

### Scope

| Type | Definition | Purpose |
|------|------------|---------|
| `Scope` | `Record<string, unknown>` | Mutable key-value map holding all runtime variables during flow execution |

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/engine/types.ts` | `Scope` (type) | Type alias for the mutable runtime variable store |
| `src/engine/types.ts` | `AgentStep` (interface) | Step type: invoke an agent with a prompt template |
| `src/engine/types.ts` | `ScriptStep` (interface) | Step type: run a built-in script |
| `src/engine/types.ts` | `ForeachStep` (interface) | Step type: iterate over an array |
| `src/engine/types.ts` | `LoopStep` (interface) | Step type: repeat until a condition or cap |
| `src/engine/types.ts` | `IfStep` (interface) | Step type: conditional execution |
| `src/engine/types.ts` | `ReadFileStep` (interface) | Step type: read file into scope |
| `src/engine/types.ts` | `Step` (type) | Discriminated union of all step types |
| `src/engine/types.ts` | `FlowDefinition` (interface) | Top-level structure: `name`, optional `description`, and `steps` array |
| `src/engine/loader.ts` | `listFlows()` | List bundled flows as `FlowInfo[]` (name + optional description) |
| `src/engine/loader.ts` | `flowExists()` | Check whether a named flow YAML file exists |
| `src/engine/loader.ts` | `FlowInfo` (interface) | Lightweight listing type returned by `listFlows()` |

## YAML ↔ TypeScript Mapping

The YAML syntax maps to the TypeScript types via the loader:

| YAML Key | TypeScript Type | Parser Function |
|----------|-----------------|-----------------|
| `agent:` | `AgentStep` | `parseAgentStep()` (internal) |
| `script:` | `ScriptStep` | `parseScriptStep()` (internal) |
| `foreach:` | `ForeachStep` | `parseForeachStep()` (internal) |
| `loop:` | `LoopStep` | `parseLoopStep()` (internal) |
| `read-file:` | `ReadFileStep` | `parseReadFileStep()` (internal) |
| `if:` + `then:` | `IfStep` | `parseIfStep()` (internal) |

> **Note:** The `if` step uses a two-key form (`if:` + `then:`) rather than the single-key pattern used by other step types. The loader handles this special case before dispatching on the single key.

## Reference Implementations

- `src/engine/types.ts` — all type definitions for the flow DSL
- `src/engine/loader.ts` — parser that validates YAML objects into the typed `FlowDefinition` structure
- `flows/init.flow.yaml` — real-world flow using all six step types (agent, script, foreach, loop, if, read-file)
- `flows/update.flow.yaml` — compact flow demonstrating if + foreach + loop composition

## Related Concepts

- [Scope and Expressions](./scope-and-expressions.md)
- [Templates and Prompt Rendering](./templates-and-prompt-rendering.md)
- [Agent Interface](./agent-interface.md)
- [Output and Progress Display](./output-and-progress.md)
