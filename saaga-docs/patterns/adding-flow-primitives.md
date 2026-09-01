---
title: Adding Flow Primitives
type: pattern
sources:
  - src/engine/types.ts
  - src/engine/loader.ts
  - src/engine/runner.ts
  - src/engine/phases.ts
  - src/engine/primitives/read-file.ts
  - src/engine/primitives/foreach.ts
last_verified: 2026-09-01
---

# Adding Flow Primitives

## When to Use

When a flow needs something the six existing primitives cannot express — see
[flow definitions](../concepts/flow-definitions.md) for what they cover. Rule out a
[built-in script](../concepts/script-registry.md) first: anything that is "run some code
and put the result in scope" is a script, one new file and no engine change. A primitive is
warranted when the *shape* of a step is new, which means new control flow.

## Pattern

Six files change, in this order. The example adds a leaf primitive, `write-file`.

```typescript
// 1. src/engine/types.ts — the step's shape, and a member in the `Step` union.
export interface WriteFileStep {
  type: "write-file"; path: string; content: string; label?: string;
}

// 2. src/engine/loader.ts — a parse function, plus a case in parseStep()'s switch.
//    Every field is checked here; the runner may assume a parsed step is well formed.
function parseWriteFileStep(body: unknown): WriteFileStep {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("'write-file' step body must be an object");
  }
  const obj = body as Record<string, unknown>;
  if (typeof obj.path !== "string") throw new Error("'write-file.path' must be a string");
  if (typeof obj.content !== "string") throw new Error("'write-file.content' must be a string");
  return { type: "write-file", path: obj.path, content: obj.content }; // + label, if given
}

// 3. src/engine/primitives/write-file.ts — the handler. Expressions are resolved here,
//    not in the loader: a flow is parsed once and may run its steps many times.
export async function runWriteFileStep(step: WriteFileStep, scope: Scope): Promise<void> {
  await writeFile(interpolate(step.path, scope), interpolate(step.content, scope), "utf8");
}

// 4. src/engine/runner.ts — one arm in runStep()'s switch: replay check, call, record.
//    A container instead takes the runner's dispatcher, as `runForeachStep` does.
case "write-file": {
  if (replayIfJournaled(step, scope, deps, ctx, run, undefined)) return;
  await runWriteFileStep(step, scope);
  await deps.journal?.append({ addr: ctx.addr, type: "write-file", at: new Date().toISOString() });
  return;
}
```

Then `src/engine/phases.ts`, where `countStep()` returns 1 if the step is a phase the user
waits on and 0 if it is plumbing like `read-file`, and finally
`tests/engine/write-file.test.ts`: the loader's rejections field by field, and the
handler's effect on scope and disk.

## Key Points

- Parse strictly, run trustingly. Anything the loader accepts, the runner will execute.
- A leaf's only legitimate effect on scope is the variable it declares in `set`; a
  container that binds one restores the previous value in a `finally`, as `foreach` and
  `loop` do, so a nested block shadows rather than overwrites.
- A value written to scope has to be JSON-serialisable, and the new leaf type belongs in
  `StepRecord.type`: [flow execution](../features/flow-execution.md) journals both.
- Primitives never import the runner; a container takes a `StepDispatcher` callback, which
  keeps the dependency one-way. Where each file goes and how it imports are
  [file layout](../conventions/file-layout.md) and
  [module imports](../conventions/module-imports.md).

## Reference Implementations

| File | Function/Method | Notes |
| --- | --- | --- |
| `src/engine/primitives/read-file.ts` | `runReadFileStep()` | The smallest complete leaf: interpolate, act, assign to `set` |
| `src/engine/primitives/foreach.ts` | `runForeachStep()`, `StepDispatcher` | The container shape, including save/restore of the bound variable |
| `src/engine/loader.ts` | `parseFlowDefinition()` | Every existing parse function, and the `if` step's multi-key exception |

## Anti-Patterns

**Do NOT:**

- Resolve `${…}` expressions in the loader. A parsed flow is reused across iterations and
  items; a value baked in at parse time is the wrong one by the second round.
- Add a primitive for something a script can do — control flow earns one, work does not.
- Skip the phase-counter arm. An uncounted step silently shifts every `Phase N/M` after it.
- Let a handler call `runner.ts` directly, or leave the step out of the journal: the first
  is the circular import the dispatcher avoids, the second is re-run on every resume.
