# Adding Flow Primitives

## When to Use

Use this pattern when you need to add a new step type to the flow engine — for example, a `wait` step, a `parallel` step, or a `set-var` step. This involves defining the type, writing a parser, implementing the runtime handler, and wiring it into the runner's dispatch logic.

## Pattern

````typescript
// 1. Define the type in src/engine/types.ts
export interface WaitStep {
  type: "wait";
  duration: number; // milliseconds
}

// 2. Add to the Step union in src/engine/types.ts
export type Step =
  | AgentStep
  | ScriptStep
  | ForeachStep
  | LoopStep
  | IfStep
  | ReadFileStep
  | WaitStep; // ← add here

// 3. Add a parser function in src/engine/loader.ts
function parseWaitStep(body: unknown): WaitStep {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("'wait' step body must be an object");
  }
  const obj = body as Record<string, unknown>;
  if (typeof obj.duration !== "number" || obj.duration < 0) {
    throw new Error("'wait.duration' must be a non-negative number");
  }
  return { type: "wait", duration: obj.duration };
}

// 4. Register the parser in the switch statement in parseStep():
//    case "wait":
//      return parseWaitStep(body);

// 5. Create the handler file at src/engine/primitives/wait.ts
import type { Scope, WaitStep } from "../types.js";

export async function runWaitStep(
  step: WaitStep,
  scope: Scope,
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, step.duration));
}

// 6. Wire into the runner's dispatch in src/engine/runner.ts:
//    import { runWaitStep } from "./primitives/wait.js";
//
//    case "wait":
//      await runWaitStep(step, scope);
//      return;
````

## Key Points

- Every step type must be added to the `Step` discriminated union in `src/engine/types.ts`
- The `type` field is the discriminant — it determines which parser and handler are used
- Parser functions live in `src/engine/loader.ts` as internal (non-exported) functions
- Parser functions must validate every field and throw descriptive `Error` messages
- Handler functions live in `src/engine/primitives/<name>.ts` and are exported
- The `parseStep()` function in `loader.ts` uses a single-key detection pattern: each YAML step object has exactly one top-level key that identifies the step type (exception: `if` uses two keys: `if:` + `then:`)
- If your step needs child steps (like `foreach`, `loop`, `if`), accept a `StepDispatcher` callback to avoid circular imports with `runner.ts`
- If your step needs to support `commit:`, add the optional `commit` field and call `runCommitField()` in the runner after execution

## Step Anatomy

A step primitive has three layers:

| Layer | File | Responsibility |
|-------|------|----------------|
| Type | `src/engine/types.ts` | Define the interface and add to the `Step` union |
| Parser | `src/engine/loader.ts` | Validate raw YAML and return typed object |
| Handler | `src/engine/primitives/<name>.ts` | Execute the step logic at runtime |
| Registration | `src/engine/runner.ts` | Dispatch to the handler in `runStep()` |

## Reference Implementations

| File | Function/Method | Notes |
|------|-----------------|-------|
| `src/engine/primitives/read-file.ts` | `runReadFileStep()` | Simple handler: reads a file, writes to scope. No child steps, no dispatcher needed. |
| `src/engine/primitives/loop.ts` | `runLoopStep()` | Complex handler: manages iteration counter, evaluates predicates, dispatches child steps. |
| `src/engine/primitives/foreach.ts` | `runForeachStep()` | Complex handler: resolves array, manages loop variable save/restore, supports `when:` filtering and `onIterationDone` callback. |
| `src/engine/primitives/if.ts` | `runIfStep()` | Conditional handler: evaluates predicate, dispatches child steps. |
| `src/engine/primitives/script.ts` | `runScriptStep()` | External integration handler: looks up registry, interpolates args, optionally stores result. |

## Anti-Patterns

**Do NOT:**

- Export parser functions — they are internal to `loader.ts` and only called by `parseStep()`
- Skip field validation in parsers — every field must be type-checked; the engine trusts parsed types at runtime
- Import `runStep` directly from `runner.ts` into a primitive — use the `StepDispatcher` callback pattern (see `foreach.ts`) to avoid circular dependencies
- Forget to handle scope variable restoration — if your step binds a variable (like `foreach` binds its `var:` or `loop` binds `iteration`), save the previous value and restore it in a `finally` block
- Throw on missing optional fields — use `if (obj.field !== undefined)` guards and only include optional fields when present
