---
title: Adding Built-in Scripts
type: pattern
sources:
  - src/scripts/registry.ts
  - src/scripts/ensure-gitignore.ts
  - src/scripts/detect-changes.ts
  - src/scripts/check-plan-budget.ts
  - src/engine/primitives/script.ts
---

# Adding Built-in Scripts

## When to Use

When a flow needs work whose answer is decidable in code: reading or writing a file,
measuring something, checking a condition an agent should not be paid to check. Reach for a
[flow primitive](./adding-flow-primitives.md) only when the *shape* of a step is new, and
for an agent step only when the work needs judgement.

## Pattern

```typescript
// 1. src/scripts/count-todos.ts — the handler. Its filename stem is the script id.
import type { ScriptContext } from "./registry.js";

export interface CountTodosArgs {
  /** Absolute path to the application directory. */
  app_dir: string;
  /** When `"true"`, finding none fails instead of returning zero. */
  require_any?: string;
}

export async function countTodos(
  args: CountTodosArgs,
  ctx: ScriptContext,
): Promise<{ count: number }> {
  // Args arrive as already-interpolated strings: validate and coerce here.
  if (!args.app_dir) throw new Error("count-todos: 'app_dir' arg is required");
  const count = await scan(args.app_dir);
  if (count > 100) ctx.warn?.(`count-todos: ${count} TODOs is a lot`); // worth saying only
  if (args.require_any === "true" && count === 0) {
    // A failure the run's own inputs decide: resuming would replay it unchanged.
    throw new NonResumableError("count-todos: 'require_any' is set but none were found");
  }
  return { count };
}

// 2. src/scripts/registry.ts — one entry, keyed by the id.
"count-todos": countTodos as unknown as ScriptHandler,
```

```yaml
# 3. flows/<name>.flow.yaml — `set` binds the result; every other key becomes an arg.
- script: { name: count-todos, app_dir: "${app_path}", require_any: "true", set: todos }
```

Then `tests/scripts/count-todos.test.ts`: each required arg's rejection, the coercion of
each optional one, and the shape a flow reads fields off.

## Key Points

- Args are strings and only strings, because a step's YAML values are interpolated before
  the handler sees them. `"true"` is the boolean idiom; numbers are parsed.
- The return value is assigned to `set` and must be JSON-serialisable — the step journal
  replays it on a resumed run. Return a flat object of scalars when a flow will branch on
  it, so `${todos.count}` resolves.
- `ctx.warn` is optional-chained everywhere: a script invoked outside a run has no logger to
  warn into. Throw a plain `Error` for something a retry could clear and `NonResumableError`
  for something it cannot — see [error messages](../conventions/error-messages.md); where
  the files go is [file layout](../conventions/file-layout.md).

## Reference Implementations

| File | Function/Method | Notes |
| --- | --- | --- |
| `src/scripts/ensure-gitignore.ts` | `ensureGitignore()` | The smallest complete handler: two args, no result, idempotent |
| `src/scripts/detect-changes.ts` | `detectChanges()` | A result object a flow branches on, plus a written report |
| `src/scripts/check-plan-budget.ts` | `checkPlanBudgetScript()` | One handler, two modes: report a verdict for a loop, or fail the run |

## Anti-Patterns

**Do NOT:**

- Read a raw argument as a number or a boolean. `args.max > 3` compares strings.
- Register an id that differs from the module's filename stem — the correspondence is what
  makes a step's `name` findable.
- Ask an agent to decide what a script can: a gate written as a prompt costs tokens on every
  run and answers differently between them.
