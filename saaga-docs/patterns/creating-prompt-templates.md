# Creating Prompt Templates

## When to Use

Use this pattern when you need to add a new prompt that an agent step will use. Prompt templates live in `prompts/*.md` and use `{var}` placeholders that the template engine substitutes at runtime.

## Pattern

```markdown
<!-- 1. Create a new file at prompts/<name>.md -->
<!-- Example: prompts/review-code.md -->

# Review Code

Review the code in `{app_path}` and produce a report.

## Context

- Application: {app}
- Run ID: {run_id}

## Instructions

1. Read all source files in the directory
2. Identify issues and improvements
3. Write a report to `{app_path}/docs/REVIEW.md`
```

```yaml
# 2. Reference the prompt from a flow YAML file (flows/<flow>.flow.yaml)
# The "prompt:" field matches the filename without the .md extension
steps:
  - type: agent
    prompt: review-code          # resolves to prompts/review-code.md
    vars:
      app: "${app}"              # flow expression → template variable
      app_path: "${app_path}"
      run_id: "${run_id}"
```

## How It Works

There are two interpolation layers, applied in order:

1. **Flow expressions** (`${var}`) — the engine's `interpolate()` function resolves these against the flow scope. This happens in the runner when it processes the step's `vars:` map.
2. **Template placeholders** (`{var}`) — `renderPromptFile()` substitutes these in the prompt file content using the resolved vars from step 1.

```
Flow Scope                    Step vars (YAML)              Prompt template
─────────────                 ────────────────              ───────────────
{ app: "myapp",         →     vars:                    →    "Review {app}
  app_path: "/code" }          app: "${app}"                 at {app_path}"
                               app_path: "${app_path}"
                                                             ↓
                                                        "Review myapp
                                                         at /code"
```

## Key Points

- **File naming**: the prompt file must be named `<name>.md` and placed in the `prompts/` directory. The flow step references it as `prompt: "<name>"` (without the `.md` extension).
- **Placeholder syntax**: use `{key}` where `key` matches `[a-zA-Z_][a-zA-Z0-9_]*`. Multi-word keys use underscores (e.g., `{app_path}`).
- **Lenient by default**: unmatched placeholders are left intact in the output. This allows prompt templates to use tokens like `{Type}` or `{ServiceOrModule}` as literal instructional text without needing escaping.
- **All vars must be declared in the step**: the `vars:` map in the flow YAML determines which scope variables become available as template placeholders. If a scope variable isn't mapped in `vars:`, it won't be substituted in the prompt.
- **Prompt resolution path**: `<PROMPTS_DIR>/<step.prompt>.md` where `PROMPTS_DIR` is `<PACKAGE_ROOT>/prompts`.

## Reference Implementations

| File | Description |
|------|-------------|
| `prompts/document-architecture.md` | Architecture generation prompt — uses `{app}` |
| `prompts/plan-init.md` | Initial documentation plan prompt |
| `prompts/slice-doc.md` | Single-phase documentation prompt — uses `{plan}` and `{phase_number}` |
| `prompts/verify-domain-documentation.md` | Quality verification prompt |
| `prompts/fix-documentation.md` | Documentation fix prompt |
| `prompts/plan-update.md` | Incremental update plan prompt |
| `prompts/update-agents-md.md` | AGENTS.md update prompt |

## Anti-Patterns

**Do NOT:**

- Use `${var}` syntax in prompt templates — that syntax is for flow expressions, not template placeholders. Prompt templates use `{var}` (single braces).
- Rely on strict mode for production prompts — strict mode (`{ strict: true }`) is only used in unit tests. The engine always calls `renderPromptFile()` in lenient mode so instructional placeholder-like text is preserved.
- Put prompt files outside the `prompts/` directory — the runner resolves prompts relative to `PROMPTS_DIR`. Files elsewhere won't be found.
- Reference a prompt name in flow YAML that doesn't have a corresponding file — `renderPromptFile()` throws `TemplateFileNotFoundError` if the file doesn't exist.
