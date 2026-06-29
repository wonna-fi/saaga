# Script Registry

## Business Definition

The Script Registry is the mechanism by which Saaga maps script names (used in flow YAML `script:` steps) to TypeScript handler functions. It allows the flow engine to execute built-in data operations — such as parsing a documentation plan, generating a content baseline, or detecting file changes — without shelling out to external processes. The registry is a simple string-keyed map, making it easy to extend with new scripts or override entries for testing.

## Configuration

| Source | Description |
|--------|-------------|
| `src/scripts/registry.ts` | Defines the `defaultScriptRegistry` with all built-in scripts |
| `RunFlowDeps.scripts` | Optional override registry passed through `runFlow()` deps (used by tests) |

**How to access:**
- `defaultScriptRegistry` — the production registry, imported by the script step handler
- Custom registries can be passed via `RunFlowDeps.scripts` to override or extend the defaults during testing

## Data Storage

| Type | Field/Property | Purpose |
|------|----------------|---------|
| `ScriptContext` | `cwd` | Working directory: the application being documented |
| `ScriptHandler` | `(args, ctx) => Promise<unknown>` | Async function signature all handlers must implement |
| `ScriptRegistry` | `Record<string, ScriptHandler>` | Maps script name strings to handler functions |
| `ScriptStep` | `name` | The registry key used to look up the handler |
| `ScriptStep` | `args` | Key-value arguments passed to the handler (interpolated from scope) |
| `ScriptStep` | `set` | Optional scope variable name to store the handler's return value |

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Export | Purpose |
|--------|-----------------|---------|
| `src/scripts/registry.ts` | `ScriptContext` (interface) | Context object passed to every script handler |
| `src/scripts/registry.ts` | `ScriptHandler` (type) | Function signature: `(args, ctx) => Promise<unknown>` |
| `src/scripts/registry.ts` | `ScriptRegistry` (type) | `Record<string, ScriptHandler>` — the registry type |
| `src/scripts/registry.ts` | `defaultScriptRegistry` (const) | Production registry with all built-in scripts |
| `src/engine/primitives/script.ts` | `runScriptStep()` | Looks up the handler, interpolates args from scope, invokes the handler, and optionally stores the result |

## Registered Built-in Scripts

| Registry Key | Handler Module | Purpose |
|--------------|---------------|---------|
| `"parse-plan"` | `src/scripts/parse-plan.ts` | Extracts phases from a plan file's YAML frontmatter |
| `"generate-baseline"` | `src/scripts/generate-baseline.ts` | Writes `<docs_dir>/BASELINE` content manifest |
| `"detect-changes"` | `src/scripts/detect-changes.ts` | Compares work tree against BASELINE, classifies differences |
| `"archive-quick-update"` | `src/scripts/archive-quick-update.ts` | Copies the detect-changes report into the quick-update metadata folder for later verification |
| `"collect-quick-updates"` | `src/scripts/collect-quick-updates.ts` | Snapshots unverified quick-update metadata folders and writes a JSON manifest |
| `"remove-quick-updates"` | `src/scripts/remove-quick-updates.ts` | Deletes exactly the quick-update metadata folders listed in a manifest |
| `"install-rules"` | `src/scripts/install-rules.ts` | Installs documentation rule stubs into the target application directory |

## Internal Implementation

The script step handler in `src/engine/primitives/script.ts` performs three operations:

1. **Registry lookup** — resolves `step.name` against the registry (falls back to `defaultScriptRegistry` if no override is provided). Throws `Error: Unknown script: <name>` if no handler is found.
2. **Argument interpolation** — iterates `step.args` and resolves each value through `interpolate()` using the current flow scope.
3. **Result storage** — if `step.set` is defined, the handler's return value is stored into the scope under that variable name, making it available to subsequent steps via `${varName}`.

## Reference Implementations

- `src/scripts/parse-plan.ts` — accepts `{ file }` args, returns `Phase[]` array stored in scope
- `src/scripts/detect-changes.ts` — accepts `{ app_dir, output_dir, docs_dir }` args, returns `DetectChangesResult` with per-classification counts
- `src/scripts/generate-baseline.ts` — accepts `{ app_dir, docs_dir }` args, returns `void` (side effect: writes BASELINE file)
- `src/scripts/archive-quick-update.ts` — accepts `{ changes_path, dest_dir, summary_path? }` args, returns `void` (side effect: if `summary_path` is provided, verifies the summary exists before copying; throws if it doesn't)
- `src/scripts/collect-quick-updates.ts` — accepts `{ metadata_dir, output_dir }` args, returns `CollectQuickUpdatesResult` with `count`, `manifest_path`, and `ids`
- `src/scripts/remove-quick-updates.ts` — accepts `{ manifest }` args, returns `void` (side effect: deletes metadata folders listed in manifest)
- `src/scripts/install-rules.ts` — accepts `{ app_dir, app, rule_targets, docs_dir }` args, returns `void` (side effect: upserts rule stubs into rule files for the requested targets)

## Related Concepts

- [Flow DSL](./flow-dsl.md) — defines the `ScriptStep` type that triggers script execution
- [Scope and Expressions](./scope-and-expressions.md) — the interpolation system used to resolve script arguments and store results
- [Baseline and Change Detection](./baseline-and-change-detection.md) — the domain of the `generate-baseline` and `detect-changes` built-in scripts
