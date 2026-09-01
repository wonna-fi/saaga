---
title: Extending Workflows
type: pattern
sources:
  - flows/init.flow.yaml
  - flows/quick-update.flow.yaml
  - src/engine/loader.ts
  - src/agent/fake-agent.ts
  - tests/cli/init.test.ts
---

# Extending Workflows

## When to Use

When you are changing what a bundled flow *does* — adding a step, changing a loop bound,
introducing a new artifact — or adding a whole new flow. Editing only what an existing step
instructs an agent to do is a prompt change and needs none of this: the flow file names
[the template](../concepts/prompt-templates.md), whose content is free to change under it.

## Pattern

A flow is a file, the prompts it names, and a test that drives both, all working against
one [scope](../concepts/scope-and-expressions.md) the CLI seeds before the first step.

```yaml
# flows/audit.flow.yaml — `name:` matches the filename stem, because
# `saaga run audit` resolves flows/<name>.flow.yaml. No registration step:
# the CLI lists whatever is in the directory.
name: audit
description: Re-check every document's claims against its sources.
steps:
  # Anything not seeded, a step must put in scope itself with `set`.
  - script:
      name: detect-changes
      label: detecting changes
      app_dir: ${app_path}
      output_dir: ${run_dir}
      docs_dir: ${docs_dir}
      set: changes                     # binds {count, changes_path, ...}

  - if: '${changes.count} != 0'
    label: auditing documentation
    skip_label: nothing to audit       # the line a skipped run prints
    then:
      - loop:
          max: 3                       # the bound is flow data, not TypeScript
          until: '${status} == "PASS"'    # evaluated after each round
          do:
            # prompts/audit-docs.md must exist; a {placeholder} with no matching
            # var is left intact in the rendered prompt rather than failing it.
            - agent:
                prompt: audit-docs
                model: high
                label: auditing
                vars:
                  docs_dir: ${docs_dir}
                  changes_path: ${changes.changes_path}
                  status_path: ${run_dir}/audit-status-${iteration}.txt
            - read-file:
                path: ${run_dir}/audit-status-${iteration}.txt
                set: status
                trim: true
            - if: '${status} != "PASS"'
              then:
                - agent: { prompt: fix-documentation, model: high, vars: { ... } }
```

```typescript
// tests/cli/audit.test.ts — the fake agent matches a scenario by substring of
// the rendered prompt and can write the files a later step reads.
const fake = new FakeAgent({
  "Audit the Documentation": {
    exitCode: 0,
    effect: async (_opts, prompt) => {
      const path = prompt.match(/status to `([^`]+)`/)![1];
      await writeFile(path, "PASS", "utf8");
    },
  },
});
expect(await runCli(["run", "audit", app], { agent: fake })).toBe(0);
expect(fake.calls).toHaveLength(1);
```

## Key Points

- If reaching a loop's cap must fail the run, add a deterministic step after the loop —
  [flow execution](../features/flow-execution.md) covers what `max` does on its own, and
  [the `init` workflow](../features/init-workflow.md) shows the pattern in place.
- Every value a later step reads must have been `set` by an earlier one. There is no
  forward reference and no arithmetic, so a path shared *between* iterations has to be
  fixed rather than computed.
- A prompt can be told to write somewhere that does not exist yet; which `vars` paths get
  their parent created first is [flow execution](../features/flow-execution.md)'s to say.
- Flow files, prompts and tests all have fixed locations — see
  [File Layout](../conventions/file-layout.md). Prefer an existing built-in to a new one;
  [Adding Built-in Scripts](./adding-built-in-scripts.md) covers when there is none.

## Reference Implementations

| File | Function/Method | Notes |
| --- | --- | --- |
| `flows/init.flow.yaml` | — | Every primitive in one file: the budget loop, the architecture verify/fix loop, the per-phase `foreach` |
| `flows/quick-update.flow.yaml` | — | The smallest complete flow: one agent step, a status read, two `if` branches |
| `src/engine/loader.ts` | `listFlows()`, `flowExists()` | What makes a new file in `flows/` runnable without registering it |
| `src/agent/fake-agent.ts` | `FakeAgent` | Scenario matching by prompt substring, plus `calls` for asserting the sequence |

## Anti-Patterns

**Do NOT:**

- Encode in TypeScript a decision the flow file can express. The loop bound, the exit
  predicate and the skip condition are flow data precisely so that changing them is a diff
  to one YAML file.
- Add a step whose output nothing reads. If no later step names it in `vars`, an expression
  or `expect_file`, it is a cost with no effect.
- Reuse a scope variable for a second meaning: `init` gives its architecture loop
  `arch_status` rather than the per-phase `status` for exactly this reason.
- Summarise a prompt's instructions in the flow file's comments. The prompt is the
  contract; a comment restating it is a second copy that will drift.
