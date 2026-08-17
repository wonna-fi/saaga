# Pattern: Adding Unstable Features

## When to Use

Use this pattern when introducing experimental behavior that must remain opt-in, may break without a semver bump, and should not affect default Saaga users.

## Pattern

1. Add the feature name to the `UNSTABLE_FEATURES` tuple in `src/unstable-features.ts` (single source of truth for config and CLI validation).
2. Gate runtime behavior with the typed helper:

```typescript
import { isUnstableFeatureEnabled } from "./unstable-features.js";

if (isUnstableFeatureEnabled("your-feature")) {
  // feature-gated behavior
}
```

3. Update the "Available unstable features" table in `README.md`.
4. Add tests that enable the feature (via config and/or `--unstable-feature`) and assert the gated behavior.
5. Document the feature in [Unstable Features](../concepts/unstable-features.md).

## Key Points

- The process-wide set is initialized once per `runCli()` via `bootstrapUnstableFeatures()` / `initUnstableFeatures()`.
- `resetUnstableFeatures()` exists for test isolation between `runCli()` calls.
- Config validation rejects unknown names at load time; CLI validation rejects unknown names at bootstrap.
- Enabling any feature prints a `[WARN]` listing active names before other work.

## Reference Implementations

- `src/unstable-features.ts` — registry API
- `tests/unstable-features.test.ts` — unit coverage for resolution and enablement
- `tests/cli/unstable-features.test.ts` — CLI/config integration

## Anti-Patterns

- Hard-coding feature name strings outside `UNSTABLE_FEATURES` / `UnstableFeature` (bypasses compile-time checks).
- Shipping experimental defaults without requiring opt-in via config or `--unstable-feature`.
- Documenting an unstable feature as a stable public API or omitting the semver exemption warning.
