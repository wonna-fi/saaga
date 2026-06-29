# Adding Built-in Scripts

## When to Use

Use this pattern when you need to add a new data operation that flow YAML can invoke via a `script:` step. Built-in scripts handle non-agent work such as file parsing, content generation, or external tool invocations that return structured data into the flow scope.

## Pattern

```typescript
// 1. Create a new file at src/scripts/<name>.ts
import type { ScriptContext } from "./registry.js";

// Define the args interface — these keys come from the flow YAML step body
export interface MyScriptArgs {
  /** Description of required arg. */
  some_input: string;
}

// Define the result interface if the script returns data to the scope
export interface MyScriptResult {
  count: number;
  output_path: string;
}

// Implement the handler function
export async function myScript(
  args: MyScriptArgs,
  _ctx: ScriptContext,
): Promise<MyScriptResult> {
  // Validate required args
  if (!args.some_input) {
    throw new Error("my-script: 'some_input' arg is required");
  }

  // Perform the operation
  const result = await doWork(args.some_input);

  // Return a result object — if the flow step has `set: varName`,
  // this object is stored into scope as ${varName} and its fields
  // become accessible via ${varName.count}, ${varName.output_path}
  return {
    count: result.length,
    output_path: "/path/to/output",
  };
}

// 2. Register in src/scripts/registry.ts:
//    Import the handler:
//      import { myScript } from "./my-script.js";
//
//    Add to defaultScriptRegistry:
//      export const defaultScriptRegistry: ScriptRegistry = {
//        "parse-plan": parsePlan as unknown as ScriptHandler,
//        "generate-baseline": generateBaseline as unknown as ScriptHandler,
//        "detect-changes": detectChanges as unknown as ScriptHandler,
//        "my-script": myScript as unknown as ScriptHandler,
//      };

// 3. Reference from flow YAML:
//    - script:
//        name: my-script
//        some_input: ${some_variable}
//        set: result_var
```

## Key Points

- Every handler must match the `ScriptHandler` signature: `(args: Record<string, string>, ctx: ScriptContext) => Promise<unknown>`
- Concrete handlers use typed args interfaces, so they are cast through `unknown` when registered (e.g., `myScript as unknown as ScriptHandler`)
- All arg values arrive as strings because the YAML step body keys (excluding `name`, `set`, `commit`) are collected into `Record<string, string>` by the loader
- `ctx.cwd` provides the working directory (the application being documented), though most scripts receive paths explicitly via args
- Validate required args at the top of the handler and throw descriptive `Error` messages with the script name prefix
- If the handler returns a value and the step has `set: varName`, the return value is stored in the flow scope — subsequent steps access it via `${varName}` or `${varName.field}`
- Handlers that only produce side effects (e.g., writing files) can return `void`

## Reference Implementations

| File | Function | Notes |
|------|----------|-------|
| `src/scripts/parse-plan.ts` | `parsePlan()` | Returns `Phase[]` array — demonstrates returning structured data to scope |
| `src/scripts/detect-changes.ts` | `detectChanges()` | Returns `DetectChangesResult` with numeric fields — demonstrates per-field scope access like `${changes.count}` |
| `src/scripts/generate-baseline.ts` | `generateBaseline()` | Returns `void` — demonstrates a side-effect-only script |

## Anti-Patterns

**Do NOT:**

- Throw errors without the script name prefix — error messages should be identifiable (e.g., `"my-script: 'input' arg is required"`)
- Access `ctx.cwd` when the script needs an explicit directory path — prefer accepting paths as args so flows can pass interpolated values
- Skip arg validation — args come from YAML interpolation and may be empty or undefined if the flow scope is misconfigured
- Store intermediate state in module-level variables — handlers must be stateless since the registry is shared across flow runs
- Use `set` in flow YAML for void-returning scripts — while it won't error, storing `undefined` in scope is misleading
