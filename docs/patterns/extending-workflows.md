# Extending Workflows

## When to Use

Use this pattern when you need to modify an existing Saaga workflow — adding new steps, swapping prompts, adjusting iteration limits, or wiring in custom scripts by editing flow YAML files.

## Pattern

```yaml
# Example: Adding a "lint documentation" step after the slice-doc agent step
# in flows/slice.flow.yaml

name: slice
steps:
  - agent:
      prompt: slice-doc
      vars:
        plan: ${plan}
        phase_number: ${phase_number}

  # 1. Add a new script step that runs after documentation is written
  - script:
      name: lint-docs
      app_dir: ${app_path}
      set: lint_result

  # 2. Add a new agent step with a custom prompt template
  - agent:
      prompt: my-custom-prompt
      vars:
        plan: ${plan}
        lint_output: ${lint_result.report_path}

  - loop:
      max: 3
      until: '${status} == "PASS"'
      do:
        # ... existing verify/fix loop steps ...
```

### Adding a New Agent Step

```yaml
# Reference a prompt template at prompts/<name>.md
- agent:
    prompt: my-new-prompt        # loads prompts/my-new-prompt.md
    vars:
      app: ${app}                # {app} placeholder in the template
      custom_var: ${some.value}  # {custom_var} placeholder
    expect_file: ${run_dir}/output.md  # optional: assert this file was created
```

### Adding a New Script Step

```yaml
# Reference a built-in script registered in defaultScriptRegistry
- script:
    name: my-script      # must exist in the script registry
    arg_one: ${value}    # all keys except name/set become script args
    arg_two: literal     # literal string arg
    set: result_var      # optional: store return value in scope as ${result_var}
```

### Swapping a Prompt

```yaml
# Change which prompt template an existing agent step uses.
# Before:
- agent:
    prompt: plan-init
    vars:
      app: ${app}
      output_path: ${run_dir}/plans/${app}-init.plan.md

# After: use a custom planning prompt
- agent:
    prompt: my-custom-plan
    vars:
      app: ${app}
      output_path: ${run_dir}/plans/${app}-init.plan.md
```

Create the new template file at `prompts/my-custom-plan.md` with `{app}` and `{output_path}` placeholders.

## Key Points

- Flow files are plain YAML — no compilation step is needed; changes take effect immediately
- The `prompt` field in an `agent` step must match a file at `prompts/<name>.md`
- The `name` field in a `script` step must match a key in `defaultScriptRegistry` (or a custom registry passed via `RunFlowDeps.scripts`)
- Variables set by `script.set` or `read-file.set` are available to all subsequent steps in the same scope
- `expect_file` on agent steps causes an `ExpectFileMissingError` if the agent did not produce the file

## Reference Implementations

| File | Function/Method | Notes |
|------|-----------------|-------|
| `flows/init.flow.yaml` | (flow definition) | Demonstrates all step types in a complete workflow |
| `flows/update.flow.yaml` | (flow definition) | Shows conditional execution with top-level `if` |
| `src/engine/runner.ts` | `runFlow()` | Executes the step sequence with scope threading |
| `src/engine/loader.ts` | `loadFlow()` | Parses and validates the YAML flow structure |

## Anti-Patterns

**Do NOT:**

- Add step types not supported by the loader — only `agent`, `script`, `foreach`, `loop`, `if`, and `read-file` are valid. Unknown keys cause a parse error.
- Use `${var}` syntax inside prompt template files — prompt templates use `{var}` (single braces). The `${var}` syntax is only for flow YAML expressions.
- Hard-code absolute paths in flow YAML — always compose paths from scope variables like `${run_dir}`, `${app_path}`, etc.
- Forget to register new scripts in `defaultScriptRegistry` before referencing them — unregistered script names cause a runtime error.
