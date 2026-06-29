# Prompt Templates

## Business Definition

Prompt templates are markdown files in the `prompts/` directory that define the instructions sent to AI coding agents during workflow execution. Each template uses `{var}` placeholders that are substituted with runtime values before the prompt is passed to the agent. Templates are the bridge between flow YAML definitions and the actual agent behavior.

## Configuration

| Source | Description |
|--------|-------------|
| `prompts/*.md` | One file per prompt template; the file name (minus `.md`) is the template identity |
| `PROMPTS_DIR` constant in `src/paths.ts` | Absolute path to the `prompts/` directory at runtime |
| `agent.prompt` field in flow YAML | References a template by name (without extension) |
| `agent.vars` field in flow YAML | Provides values for `{var}` placeholders in the template |

**How to access:**
- `renderPromptFile(path, vars)` - reads and renders a prompt template file
- `renderPrompt(template, vars)` - renders a template string with variable substitution
- `PROMPTS_DIR` (constant) - the resolved directory containing all prompt files

## Data Storage

| Object/Model/Type | Field/Property | Purpose |
|--------|-------|---------|
| `AgentStep` | `prompt` | Name of the template to load (file `prompts/<prompt>.md`) |
| `AgentStep` | `vars` | Key-value map of variables to substitute into the template |
| `RenderPromptOptions` | `strict` | When true, throws on unresolved placeholders (defaults to false) |

## The Eight Prompt Templates

| Template | File | Placeholders | Role |
|----------|------|--------------|------|
| document-architecture | `prompts/document-architecture.md` | `{app}`, `{docs_dir}` | Generate `<docs_dir>/ARCHITECTURE.md` for an application |
| plan-init | `prompts/plan-init.md` | `{app}`, `{docs_dir}`, `{output_path}` | Create a full documentation plan from scratch |
| plan-update | `prompts/plan-update.md` | `{app}`, `{docs_dir}`, `{changes_path}`, `{output_path}` | Create an incremental update plan based on detected changes |
| slice-doc | `prompts/slice-doc.md` | `{plan}`, `{phase_number}` | Document a single phase from a plan |
| verify-domain-documentation | `prompts/verify-domain-documentation.md` | `{plan}`, `{phase_number}`, `{review_path}`, `{status_path}`, `{changes_dir}`, `{docs_dir}` | Verify documentation quality; write PASS/FAIL status; optionally verify coverage against change reports |
| fix-documentation | `prompts/fix-documentation.md` | `{plan}`, `{phase_number}`, `{review_path}` | Fix errors identified in a verification report |
| quick-update | `prompts/quick-update.md` | `{app}`, `{docs_dir}`, `{changes_path}`, `{status_path}`, `{summary_path}` | Fast single-session doc update: triage, apply targeted edits, write UPDATED/SKIPPED status and summary |
| plan-verify-quick-updates | `prompts/plan-verify-quick-updates.md` | `{app}`, `{docs_dir}`, `{manifest_path}`, `{metadata_dir}`, `{output_path}` | Consolidate unverified quick-update artifacts into a verification plan |

## Placeholder Substitution Behavior

The `{var}` placeholder system (implemented in `src/templates.ts`) has specific semantics:

- Placeholders use single braces: `{var_name}` (not `${var}` — that's the expression system)
- Multiple occurrences of the same placeholder are all replaced
- Extra keys in the `vars` map (not referenced in the template) are silently ignored
- **Lenient mode** (default): unmatched placeholders are left intact — this allows templates to use `{Type}`, `{ServiceOrModule}`, etc. as literal documentation text without escaping
- **Strict mode** (`strict: true`): throws `MissingTemplateVariableError` for any unresolved placeholder

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Method | Purpose |
|--------|-----------------|---------|
| `src/templates.ts` | `renderPrompt()` | Substitute `{var}` placeholders in a template string |
| `src/templates.ts` | `renderPromptFile()` | Read a file and render its placeholders |
| `src/templates.ts` | `MissingTemplateVariableError` (class) | Thrown by `renderPrompt()` in strict mode when a placeholder has no matching variable |
| `src/templates.ts` | `TemplateFileNotFoundError` (class) | Thrown by `renderPromptFile()` when the template path does not exist |
| `src/paths.ts` | `PROMPTS_DIR` | Resolved absolute path to `prompts/` directory |

## Reference Implementations

- `prompts/document-architecture.md` — two placeholders: `{app}` and `{docs_dir}`
- `prompts/verify-domain-documentation.md` — most complex template: six placeholders controlling review output paths, docs dir, and optional coverage verification
- `prompts/plan-update.md` — four placeholders including `{docs_dir}` and a path to a pre-computed changes report

## Related Concepts

- [Templates and Prompt Rendering](./templates-and-prompt-rendering.md)
- [Flow Definitions](./flow-definitions.md)
- [Flow DSL](./flow-dsl.md)
