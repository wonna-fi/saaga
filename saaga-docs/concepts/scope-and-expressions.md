---
title: Scope and Expressions
type: concept
sources:
  - src/engine/expression.ts
  - src/engine/primitives/foreach.ts
  - src/engine/primitives/loop.ts
  - src/engine/primitives/read-file.ts
  - src/engine/primitives/script.ts
terms:
  - scope
  - interpolation
  - predicate
---

# Scope and Expressions

## Business Definition

**Scope** is the single bag of named values a running flow reads from and writes to: a flat
`Record<string, unknown>` seeded by the CLI with the run's identity and paths, and extended
as steps produce values. Every `${…}` in a flow file is an **expression** read against it.

The expression language is deliberately tiny — path lookup, string interpolation, and
one-comparison predicates. It has no arithmetic, no boolean operators and no function
calls, so a flow file cannot grow logic that belongs in a script.

## Data Storage

| Object | Field/Property | Purpose |
|--------|-------|---------|
| `Scope` | `app`, `app_path`, `docs_dir`, `run_id`, `run_dir`, `date`, `iso_date` | Seeded by the CLI before the flow starts; `init` also gets `rule_targets` |
| `Scope` | `iteration`, `loop_max` | Bound by `loop` for the duration of its body: the 1-based round, and the cap |
| `Scope` | _the `foreach` variable_ | Bound by `foreach` to the current item for the duration of the body |
| `Scope` | _anything a step `set`s_ | Whatever a `script` returned or a `read-file` read |

There is one scope per run, shallow-copied from the initial scope so the caller's object is
never mutated. It lives as long as the run: a value a step sets stays visible to every
later step, including steps outside the block that set it. The three bindings that are
*not* permanent are the loop's two and the foreach variable — each is saved before the body
runs and restored, or deleted, afterwards, so a nested loop shadows its parent rather than
overwriting it and a post-loop step referencing `${iteration}` fails rather than reading a
stale round number.

Only `script.set` and `read-file.set` write to scope; an `agent` step's output reaches the
flow by being written to a file that a later `read-file` picks up. Values that arrive this
way are journaled and replayed on resume, which is why a script's return value has to be
JSON-serialisable — see [flow execution](../features/flow-execution.md).

## Key Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `engine/expression` | `interpolate()` | Substitutes every `${…}` in a string and returns a string |
| `engine/expression` | `resolveValue()` | The raw value when the whole expression is one `${…}`, otherwise the interpolated string |
| `engine/expression` | `evaluatePredicate()` | Evaluates a `when:`, `until:` or `if:` predicate to a boolean |
| `engine/expression` | `ExpressionError` | Thrown for an undefined path or an unknown operator |

### Grammar

**Paths.** `${name}` reads a top-level variable; `${a.b}` and `${phases.0.title}` walk into
objects and arrays. The first segment must be an identifier; later segments may also be
numeric indices.

**Interpolation.** `interpolate()` replaces each reference in place and coerces the result
to a string, so `${run_dir}/plans/${app}-init.plan.md` is a path and `"${status}"` is text.
A reference whose value is `null` or `undefined` becomes the empty string. Because a
string is all it can produce, fields that need a real array — `foreach.in` above all — go
through `resolveValue()` instead, which returns the value untouched when the field is
exactly one reference and nothing else.

**Predicates.** A predicate is either `<lhs> <op> <rhs>` with `==`, `!=`, `<`, `>`, `<=` or
`>=`, or a bare expression tested for truthiness. Each operand is a `${…}` reference, a
single- or double-quoted string literal, a number literal, or a bare word taken as a string
literal. `==` and `!=` compare by string coercion, so `${phase.number} != 0` holds whether
YAML parsed the number as a number or a string; the four ordering operators coerce both
sides with `Number()`.

**Undefined variables are fatal.** Reading a name that is not in scope throws
`ExpressionError` rather than yielding an empty string, and the error names the path. That
is what turns a typo in a flow file into a failed step instead of a prompt with a hole in
it. The one place the throw is swallowed is the phase counter, which treats an
unresolvable `foreach.in` as "total not known yet" and prints `Phase 3/?`.

## Reference Implementations

- `src/engine/expression.ts` - the whole language: paths, interpolation, predicates
- `src/engine/primitives/loop.ts` - save/restore of `iteration` and `loop_max` around a body
- `src/engine/primitives/foreach.ts` - the same for the item variable, in a `finally`
- `tests/engine/expression.test.ts` - the grammar case by case

## Related Concepts

- [Flow Definitions](./flow-definitions.md)
- [Feature: Flow Execution](../features/flow-execution.md)
- [Run Context](./run-context.md)
