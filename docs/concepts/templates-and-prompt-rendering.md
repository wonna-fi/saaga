# Templates and Prompt Rendering

## Business Definition

The template system provides `{var}` placeholder substitution for prompt files. It powers how the flow engine turns parameterized prompt templates (stored in `prompts/*.md`) into concrete prompt strings before sending them to an agent. The system supports two modes: lenient (default), which leaves unmatched placeholders intact, and strict, which throws on any unmatched placeholder.

## Configuration

| Source | Description |
|--------|-------------|
| `prompts/*.md` files | Prompt template files containing `{var}` placeholders |
| `PROMPTS_DIR` constant (`src/paths.ts`) | Resolves to `<PACKAGE_ROOT>/prompts` — the directory where prompt templates live |
| Flow YAML `vars:` field | Maps variable names to values (or `${scope_var}` expressions) for each agent step |

**How to access:**

- `renderPrompt(template, vars, options?)` — substitute placeholders in a string
- `renderPromptFile(path, vars, options?)` — read a file and substitute placeholders

## Data Storage

| Type | Field/Property | Purpose |
|------|----------------|---------|
| `RenderPromptOptions` | `strict` | When `true`, throws `MissingTemplateVariableError` for unmatched placeholders. Defaults to `false`. |
| `MissingTemplateVariableError` | `key` | The placeholder name that was not found in `vars` |
| `TemplateFileNotFoundError` | `path` | The file path that could not be read |

## Placeholder Syntax

Placeholders use the pattern `{key}` where `key` matches `[a-zA-Z_][a-zA-Z0-9_]*` (the regex `PLACEHOLDER_RE`).

| Behavior | Description |
|----------|-------------|
| Multiple occurrences | All occurrences of the same key are replaced |
| Extra keys in `vars` | Ignored silently — only placeholders present in the template are substituted |
| Missing keys (lenient mode) | Placeholder is left intact in the output (e.g., `{Type}` remains `{Type}`) |
| Missing keys (strict mode) | Throws `MissingTemplateVariableError` |

> **Note:** Lenient mode is the default because prompt templates often use `{Type}`, `{ServiceOrModule}`, etc. as literal documentation text that should not be substituted.

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/templates.ts` | `renderPrompt()` | Substitutes `{key}` placeholders in a template string using a `vars` record |
| `src/templates.ts` | `renderPromptFile()` | Reads a file from disk, then delegates to `renderPrompt()` |
| `src/templates.ts` | `MissingTemplateVariableError` (class) | Thrown in strict mode when a placeholder has no corresponding variable |
| `src/templates.ts` | `TemplateFileNotFoundError` (class) | Thrown when the prompt template file does not exist (ENOENT) |
| `src/templates.ts` | `RenderPromptOptions` (interface) | Options: `strict?: boolean` |

## How the Engine Uses Templates

The flow runner (`src/engine/runner.ts`) calls `renderPromptFile()` in `runAgentStep()`:

1. Resolves the prompt path: `<PROMPTS_DIR>/<step.prompt>.md`
2. Interpolates step `vars` using the flow engine's `${scope_var}` expression system (via `interpolate()`)
3. Passes the interpolated vars to `renderPromptFile()` for `{key}` substitution
4. Sends the fully rendered string to `Agent.run()`

This means there are two distinct interpolation layers:
- **Flow expressions** (`${var}`) — resolved by `interpolate()` in `src/engine/expression.ts` against the flow scope
- **Template placeholders** (`{var}`) — resolved by `renderPrompt()` in `src/templates.ts` against the step's `vars` map

## Reference Implementations

- `src/templates.ts` — the complete template engine (both `renderPrompt` and `renderPromptFile`)
- `src/engine/runner.ts` — `runAgentStep()` (internal) shows how the engine wires template rendering into the agent step execution

## Related Concepts

- [Agent Interface](./agent-interface.md)
- [Package Paths](./package-paths.md)
