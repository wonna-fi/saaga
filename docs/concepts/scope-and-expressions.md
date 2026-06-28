# Scope and Expressions

## Business Definition

The expression system provides variable interpolation and predicate evaluation for the flow engine. It enables flow YAML files to reference runtime data via `${var}` syntax, traverse nested objects with dot-path notation (`${var.field}`), and express conditions for control-flow primitives (`foreach.when`, `loop.until`, `if.condition`). The scope is the mutable key-value store that holds all runtime variables during flow execution.

## Configuration

| Source | Description |
|--------|-------------|
| Initial scope (passed to `runFlow()`) | Variables set by the CLI before execution (e.g. `app`, `app_path`, `run_dir`) |
| `script` steps with `set:` | Scripts can write return values into the scope |
| `read-file` steps with `set:` | File contents are stored as scope variables |
| `foreach` steps with `var:` | The loop variable is bound to the current item during iteration |
| `loop` steps | Automatically set `${iteration}` to the current 1-indexed count |

**How to access:**

- `interpolate(template, scope)` — substitutes all `${path}` references in a string, returning a string
- `resolveValue(expr, scope)` — returns the raw value (preserving type) if the expression is a single `${path}`, otherwise interpolates as a string
- `evaluatePredicate(expr, scope)` — evaluates a comparison or truthy-check expression, returning a boolean

## Data Storage

| Type | Field/Property | Purpose |
|------|----------------|---------|
| `Scope` | (any key) | `Record<string, unknown>` — holds primitives, objects, and arrays set during flow execution |

### Variables Set by Primitives

| Primitive | Variable | Value |
|-----------|----------|-------|
| `foreach` | `${<var>}` (user-defined name) | Current iteration item from the array |
| `loop` | `${iteration}` | 1-indexed iteration counter |
| `script` (with `set:`) | `${<set>}` (user-defined name) | Return value of the script handler |
| `read-file` | `${<set>}` (user-defined name) | UTF-8 file contents (optionally trimmed) |

## Expression Syntax

### Interpolation (`${path}`)

The pattern `${name}` or `${name.field.subfield}` is substituted with the resolved value from scope:

| Pattern | Meaning |
|---------|---------|
| `${var}` | Resolves the top-level scope key `var` |
| `${var.field}` | Resolves `var` in scope, then reads property `field` from it |
| `${var.0.title}` | Resolves `var`, reads index `0` (array access), then reads `title` |

Path segments must match `[a-zA-Z0-9_]+` (after the first segment which must start with a letter or underscore).

**Behavior:**

- `interpolate()` always returns a string (coerces values via `String()`)
- `resolveValue()` preserves the raw type when the entire expression is a single `${path}` reference — this is how `foreach.in` receives arrays rather than the string `"[object Object]"`
- `null`/`undefined` values are coerced to empty string `""` during string interpolation
- Accessing an undefined path throws `ExpressionError`

### Predicate Evaluation

Predicates are used in `when:`, `until:`, and `if:` clauses. Two forms are supported:

**Comparison form:** `<lhs> <op> <rhs>`

| Operator | Behavior |
|----------|----------|
| `==` | String equality (both sides coerced to string) |
| `!=` | String inequality (both sides coerced to string) |
| `<` | Numeric less-than (both sides coerced to number) |
| `>` | Numeric greater-than (both sides coerced to number) |
| `<=` | Numeric less-than-or-equal (both sides coerced to number) |
| `>=` | Numeric greater-than-or-equal (both sides coerced to number) |

**Truthy form:** bare `${expr}`

Evaluates the resolved value with JavaScript `Boolean()` coercion.

### Operand Types

Operands in a comparison can be:

| Form | Example | Interpreted as |
|------|---------|----------------|
| `${var}` or `${var.field}` | `${phase.number}` | Resolved from scope |
| Quoted string | `"PASS"` or `'PASS'` | String literal (quotes stripped) |
| Numeric literal | `0`, `3`, `-1.5` | Number |
| Bare word | `PASS` | String literal |

> **Note:** `==` and `!=` use string coercion, so `${phase.number} != 0` works correctly even when `number` is a JavaScript number — both sides are converted to strings before comparison.

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/engine/expression.ts` | `interpolate()` | Substitutes all `${path}` references in a template string, returning a string |
| `src/engine/expression.ts` | `resolveValue()` | Returns raw value for single-expression strings, otherwise interpolates to string |
| `src/engine/expression.ts` | `evaluatePredicate()` | Evaluates a predicate expression (comparison or truthy check) to boolean |
| `src/engine/expression.ts` | `ExpressionError` (class) | Thrown when a path is undefined or an unknown operator is used |

## Internal Implementation

- `resolvePath(path, scope)` — traverses dot-separated path segments against the scope object tree (not exported)
- `parseOperand(operand, scope)` — classifies an operand as variable reference, quoted string, number, or bare word (not exported)
- `compare(lhs, op, rhs)` — applies the comparison operator with appropriate type coercion (not exported)

## Scope Lifecycle and Variable Binding

### Variable Restoration

Both `foreach` and `loop` primitives save and restore scope variables they shadow:

1. Before the loop: if the scope already has a variable with the same name, the old value is saved
2. During the loop: the variable is rebound on each iteration
3. After the loop: the original value is restored (or the variable is deleted if it didn't exist before)

This prevents inner loops from corrupting outer scope state.

### Scope Mutation Flow

```
CLI sets initial scope → runFlow() copies scope → steps mutate scope in-place
                                                     ↓
                                          agent: reads scope vars
                                          script: may write set: variable
                                          read-file: writes set: variable
                                          foreach: binds var per item
                                          loop: binds iteration counter
```

## Reference Implementations

- `src/engine/expression.ts` — the complete expression evaluation module (interpolation, resolution, predicates)
- `src/engine/primitives/foreach.ts` — demonstrates `resolveValue()` for array resolution and `evaluatePredicate()` for `when:` filtering
- `src/engine/primitives/loop.ts` — demonstrates `evaluatePredicate()` for `until:` condition and automatic `iteration` variable binding
- `src/engine/primitives/read-file.ts` — demonstrates `interpolate()` for path resolution and scope mutation via `set:`

## Related Concepts

- [Flow DSL](./flow-dsl.md)
- [Templates and Prompt Rendering](./templates-and-prompt-rendering.md)
