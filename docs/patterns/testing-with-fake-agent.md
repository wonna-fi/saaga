# Testing with FakeAgent

## When to Use

Use this pattern when you need to write integration tests for Saaga flows or CLI subcommands without invoking real AI agent CLIs. `FakeAgent` is a test double that returns canned results based on substring matching against the prompt, records every call for assertion, and supports side effects to simulate agent file output.

## Pattern

```typescript
// 1. Import FakeAgent and the CLI entry point
import { FakeAgent, type FakeScenarioValue } from "../../src/agent/fake-agent.js";
import { runCli } from "../../src/cli.js";

// 2. Define scenarios: each key is a substring to match against the prompt.
//    Order matters — the first matching key wins.
const fake = new FakeAgent({
  "Document the Architecture": { exitCode: 0 },
  "Plan Domain Documentation": {
    exitCode: 0,
    effect: async (_opts, prompt) => {
      // Side effect: simulate the agent writing a plan file.
      // Parse the expected output path from the prompt text.
      const match = prompt.match(/Write the plan to `([^`]+)`/);
      if (!match) throw new Error("path not found in prompt");
      await mkdir(dirname(match[1]), { recursive: true });
      await writeFile(match[1], planContent, "utf8");
    },
  },
  "Verify Domain Documentation Slice": {
    exitCode: 0,
    effect: async (_opts, prompt) => {
      // Simulate writing a verification status file
      const match = prompt.match(/Write the verification status to `([^`]+)`/);
      if (!match) throw new Error("status path not found");
      await mkdir(dirname(match[1]), { recursive: true });
      await writeFile(match[1], "PASS", "utf8");
    },
  },
});

// 3. Run the CLI, injecting the FakeAgent via CliOptions.agent.
//    This skips backend resolution entirely.
const exitCode = await runCli(["init", appDir], {
  agent: fake,
  env: { HOME: tmpHome },
});

// 4. Assert on exit code
expect(exitCode).toBe(0);

// 5. Assert on recorded calls: order, count, prompt content, and cwd
expect(fake.calls).toHaveLength(3);
expect(fake.calls[0].prompt).toContain("Document the Architecture");
expect(fake.calls[0].cwd).toBe(appDir);
```

### Side Effects for `expect_file` Steps

When a flow step declares `expect_file`, the runner verifies the file exists after the agent returns. Use the `effect` callback to write the expected file:

```typescript
const fake = new FakeAgent({
  "Plan Domain Documentation": {
    exitCode: 0,
    effect: async (_opts, prompt) => {
      // Extract the expected file path from the prompt and write it
      const m = prompt.match(/Write the plan to `([^`]+)`/);
      const planPath = m![1];
      await mkdir(dirname(planPath), { recursive: true });
      await writeFile(planPath, planYamlContent, "utf8");
    },
  },
});
```

### Simulating Failures

```typescript
// Simulate a non-zero exit code — runCli catches AgentStepFailedError
// internally and resolves with the exit code (it does NOT reject).
const fake = new FakeAgent({
  "Document the Architecture": { exitCode: 1 },
});

const exitCode = await runCli(["init", appDir], {
  agent: fake,
  env: { HOME: tmpHome },
});
expect(exitCode).not.toBe(0);
```

### Dynamic Verify/Fix Scenarios

```typescript
// FAIL on first verification call, PASS on second
let verifyCalls = 0;
const fake = new FakeAgent({
  "Verify Domain Documentation Slice": {
    exitCode: 0,
    effect: async (_opts, prompt) => {
      verifyCalls++;
      const status = verifyCalls >= 2 ? "PASS" : "FAIL";
      const m = prompt.match(/Write the verification status to `([^`]+)`/);
      await mkdir(dirname(m![1]), { recursive: true });
      await writeFile(m![1], status, "utf8");
    },
  },
  "Fix Documentation Errors": { exitCode: 0 },
});
```

## Key Points

- **Substring matching**: scenarios are matched by checking `prompt.includes(key)`. The first matching key wins, so order scenario keys from most specific to least specific.
- **`CliOptions.agent` bypass**: when `agent` is provided, the CLI skips `resolveBackend()` entirely — no backend env vars needed.
- **`calls` array**: every invocation is recorded in `fake.calls` as `{ prompt, cwd }`, allowing assertions on call order, count, prompt content, and working directory.
- **`effect` timing**: the effect callback runs after the call is recorded but before the result is returned. This means you can inspect `fake.calls` inside an effect.
- **Unmatched prompts throw**: if no scenario key is a substring of the prompt, `FakeAgent` throws `"FakeAgent: no scenario matched prompt (first 120 chars): ..."`. This catches unexpected agent invocations.

## Reference Implementations

| File | Function/Pattern | Notes |
|------|-----------------|-------|
| `tests/cli/init.test.ts` | `planInitScenario()` helper | Extracts plan path from prompt, writes plan content as side effect |
| `tests/cli/init.test.ts` | `verifyScenario()` helper | Stateful scenario that returns PASS or FAIL based on call count |
| `tests/cli/slice.test.ts` | Slice subcommand tests | Tests run-dir derivation and fresh-context fallback with FakeAgent |
| `tests/agent/fake-agent.test.ts` | Unit tests for FakeAgent | Covers matching, ordering, recording, and unmatched prompt errors |
| `tests/engine/foreach.test.ts` | Engine-level tests | Uses FakeAgent to test flow control primitives |

## Anti-Patterns

**Do NOT:**

- Rely on scenario key ordering when keys overlap — e.g., if you have both `"Plan"` and `"Plan Domain"`, put the longer/more specific key first
- Forget to write `expect_file` outputs in effects — the runner will throw `ExpectFileMissingError` after the agent returns
- Use `FakeAgent` in production — it is only exported for test use; production code uses `createAgent()` to construct real backends
- Modify `fake.calls` directly — treat it as read-only for assertions; the array is populated by `FakeAgent.run()`
