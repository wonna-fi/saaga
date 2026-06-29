# Writing Flow YAML Files

## When to Use

Use this pattern when you need to create or modify a workflow definition. Flows are the primary orchestration mechanism in Saaga — they define what steps run, in what order, with what parameters, and under what conditions.

## Pattern

```yaml
# A minimal flow file with the required top-level structure
name: my-workflow
steps:
  # 1. Agent step: invoke an AI agent with a prompt template
  - agent:
      prompt: my-prompt-template
      vars:
        app: ${app}
        output_path: ${run_dir}/output.md
      expect_file: ${run_dir}/output.md

  # 2. Script step: run a built-in script and store the result
  - script:
      name: parse-plan
      file: ${run_dir}/output.md
      set: phases

  # 3. Foreach step: iterate over an array from scope
  - foreach:
      var: phase
      in: ${phases}
      when: '${phase.number} != 0'
      do:
        - agent:
            prompt: slice-doc
            vars:
              plan: ${run_dir}/output.md
              phase_number: ${phase.number}

  # 4. Loop step: repeat until a condition is met (max 3 times)
  - loop:
      max: 3
      until: '${status} == "PASS"'
      do:
        - agent:
            prompt: verify-domain-documentation
            vars:
              review_path: ${run_dir}/review-${iteration}.md
              status_path: ${run_dir}/status-${iteration}.txt

        - read-file:
            path: ${run_dir}/status-${iteration}.txt
            set: status
            trim: true

        - if: '${status} != "PASS"'
          then:
            - agent:
                prompt: fix-documentation
                vars:
                  review_path: ${run_dir}/review-${iteration}.md

  # 5. Read-file step: load file contents into a variable
  - read-file:
      path: ${app_path}/docs/BASELINE
      set: baseline_content

  # 6. If step: conditionally execute steps
  - if: '${changes.count} != 0'
    then:
      - agent:
          prompt: plan-update
          vars:
            changes_path: ${changes.changes_path}
```

## YAML Syntax Rules

### Top-Level Structure

Every flow file must have:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Identifier for the flow (matches the filename without `.flow.yaml`) |
| `steps` | array | Yes | Ordered list of step objects |

### Step Object Key Rules

- Most steps use a **single key** that identifies the step type: `agent:`, `script:`, `foreach:`, `loop:`, `read-file:`
- The `if` step is the exception: it uses **two keys** (`if:` + `then:`)
- Step values are objects containing the step's configuration fields

### Variable Interpolation

Two interpolation systems interact in flows:

| Syntax | Resolved by | When | Context |
|--------|-------------|------|---------|
| `${var}` | Flow expression engine | At runtime, during step execution | Can reference any scope variable |
| `{var}` | Template renderer | When rendering prompt files | Only for `vars:` values passed to prompt templates |

In the YAML file, you use `${var}` syntax. The template `{var}` placeholders live inside the `.md` prompt files, not in the YAML.

### Quoting Predicates

Predicate strings (in `when:`, `until:`, `if:`) should be quoted in YAML to prevent the parser from misinterpreting operators:

```yaml
# Correct: quoted predicate
when: '${phase.number} != 0'
until: '${status} == "PASS"'

# Incorrect: unquoted may cause YAML parse errors
when: ${phase.number} != 0
```

## Key Points

- Flow files live in the `flows/` directory and follow the naming convention `<name>.flow.yaml`
- Steps execute sequentially from top to bottom within their containing array
- `loop` automatically provides `${iteration}` (1-indexed) inside its body
- `script` arguments are all key-value pairs in the body except `name` and `set` — everything else becomes an arg
- `expect_file` on agent steps causes the engine to assert the file exists after the agent finishes; throws `ExpectFileMissingError` if missing

## Reference Implementations

| File | Description |
|------|-------------|
| `flows/init.flow.yaml` | Full workflow using all six step types: sequential agents, scripts, foreach with when filter, nested loop with read-file and if |
| `flows/update.flow.yaml` | Demonstrates top-level if conditional and nested foreach with loop |
| `flows/quick-update.flow.yaml` | Agent writing a status file that controls conditional archiving |
| `flows/verify-quick-updates.flow.yaml` | Collecting external artifacts, planning from them, and cleaning up afterwards |

## Anti-Patterns

**Do NOT:**

- Use `{var}` syntax in flow YAML — that's for prompt template files only; use `${var}` for flow expressions
- Forget to quote predicate strings — unquoted `${...} != ...` can break YAML parsing
- Set `loop.max` to 0 or negative — the loader requires a positive integer
- Reference a variable before it's set — steps execute top-to-bottom, so a `read-file` with `set: status` must come before a step that uses `${status}`
- Assume `foreach.in` works with strings — it must resolve to an array (use `resolveValue()` semantics)
