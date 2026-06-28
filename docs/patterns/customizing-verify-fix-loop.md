# Customizing the Verify/Fix Loop

## When to Use

Use this pattern when you need to understand or modify the quality verification loop that runs after each documentation slice. The verify/fix loop uses the `loop` + `read-file` + `if` pattern to implement iterative quality verification, and you may need to adjust the iteration limit, change the verification criteria, or modify the feedback mechanism.

## Pattern

```yaml
# The standard verify/fix loop as used in flows/slice.flow.yaml
# and embedded within foreach iterations in init.flow.yaml / update.flow.yaml

- loop:
    max: 3                           # 1. Hard iteration cap
    until: '${status} == "PASS"'     # 2. Early-exit predicate
    do:
      # Step A: Run verification agent
      - agent:
          prompt: verify-domain-documentation
          vars:
            plan: ${plan}
            phase_number: ${phase_number}
            review_path: ${run_dir}/slice-${phase_number}/review-${iteration}.md
            status_path: ${run_dir}/slice-${phase_number}/status-${iteration}.txt

      # Step B: Read the status file the verifier wrote
      - read-file:
          path: ${run_dir}/slice-${phase_number}/status-${iteration}.txt
          set: status          # assigns "PASS" or "FAIL" to ${status}
          trim: true           # strip whitespace/newlines

      # Step C: If verification failed, run the fix agent
      - if: '${status} != "PASS"'
        then:
          - agent:
              prompt: fix-documentation
              vars:
                plan: ${plan}
                phase_number: ${phase_number}
                review_path: ${run_dir}/slice-${phase_number}/review-${iteration}.md
```

### How It Works

1. The `loop` primitive sets `${iteration}` to the current count (1-indexed) before each iteration
2. The verify agent writes two files: a detailed review report and a simple PASS/FAIL status
3. `read-file` loads the status into scope variable `${status}`
4. The `until` predicate checks `${status} == "PASS"` — if true, the loop exits early
5. If status is not PASS, the `if` block runs the fix agent with the review as input
6. The loop repeats (up to `max` times) until PASS or the cap is reached

### Adjusting the Iteration Cap

```yaml
# Increase to 5 iterations for stricter quality enforcement
- loop:
    max: 5
    until: '${status} == "PASS"'
    do:
      # ... same steps ...
```

### Changing the Exit Condition

```yaml
# Exit on PASS or ACCEPTABLE (two valid statuses)
# Note: the verifier prompt must be updated to write these statuses
- loop:
    max: 3
    until: '${status} != "FAIL"'
    do:
      # ... same steps ...
```

### Adding a Post-Verification Step

```yaml
- loop:
    max: 3
    until: '${status} == "PASS"'
    do:
      - agent:
          prompt: verify-domain-documentation
          vars:
            plan: ${plan}
            phase_number: ${phase_number}
            review_path: ${run_dir}/slice-${phase_number}/review-${iteration}.md
            status_path: ${run_dir}/slice-${phase_number}/status-${iteration}.txt

      - read-file:
          path: ${run_dir}/slice-${phase_number}/status-${iteration}.txt
          set: status
          trim: true

      # New: log the review for external monitoring
      - script:
          name: log-review
          review_path: ${run_dir}/slice-${phase_number}/review-${iteration}.md
          status: ${status}

      - if: '${status} != "PASS"'
        then:
          - agent:
              prompt: fix-documentation
              vars:
                plan: ${plan}
                phase_number: ${phase_number}
                review_path: ${run_dir}/slice-${phase_number}/review-${iteration}.md
```

## Key Points

- The `${iteration}` variable is automatically set by the `loop` primitive (1-indexed) and restored to its previous value after the loop exits
- Review and status files include `${iteration}` in their paths so each iteration's artifacts are preserved (e.g., `review-1.md`, `review-2.md`, `review-3.md`)
- The `trim: true` option on `read-file` is critical — the status file often has trailing newlines that would cause the equality check to fail
- The `until` predicate is evaluated **after** the loop body executes, meaning the body always runs at least once
- If the loop hits `max` without the `until` condition becoming true, execution continues to the next step (no error is thrown)
- The fix agent is instructed to only fix errors identified in the review — it does not rewrite documentation wholesale

## Reference Implementations

| File | Function/Method | Notes |
|------|-----------------|-------|
| `flows/slice.flow.yaml` | (flow definition) | Standalone verify/fix loop — simplest usage |
| `flows/init.flow.yaml` | (flow definition) | Verify/fix nested inside a `foreach` with per-phase scoping |
| `src/engine/primitives/loop.ts` | `runLoopStep()` | Loop primitive implementation with iteration tracking |
| `prompts/verify-domain-documentation.md` | (prompt template) | Defines verification criteria and output format |
| `prompts/fix-documentation.md` | (prompt template) | Defines fix constraints (only fix flagged errors) |

## Anti-Patterns

**Do NOT:**

- Set `max` to 0 or a negative number — the loader validates that `max` must be a positive integer and will throw a parse error
- Forget the `trim: true` on `read-file` when reading status files — a trailing newline will cause `"PASS\n" != "PASS"` and the loop will never exit early
- Place the `until` check logic inside an `if` step instead of using the `until` field — the `until` field is the proper mechanism for early loop exit
- Modify the verification prompt to stop writing a status file — the loop depends on `read-file` loading the status into scope for the `until` predicate
- Omit `until` from a `loop` step — the loader requires it and will throw a parse error (`'loop.until' must be a string predicate`). Even if it were optional, the loop would run exactly `max` times with no early exit, defeating the purpose of the verify/fix pattern
