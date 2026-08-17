# Unstable Features

## Business Definition

Unstable features are opt-in experimental behaviors gated behind a typed registry. They are intended for Saaga core development (or users who explicitly accept the maintenance burden). Unstable features are exempt from semantic-versioning guarantees and may change or break in any release, including patch releases.

## Configuration

| Source | Description |
|--------|-------------|
| `.saaga/config.yaml` → `unstableFeatures` | Optional YAML array of known feature name strings |
| CLI flag `--unstable-feature <name>` | Repeatable; enables additional features for one invocation |

**How to access:**
- `initUnstableFeatures(features)` — replaces the process-wide enabled set (called once per CLI bootstrap)
- `isUnstableFeatureEnabled(feature)` — query whether a feature is enabled
- `resolveUnstableFeatures(configFeatures, cliFeatures)` — union config then CLI, deduplicating while preserving first-seen order
- `UNSTABLE_FEATURES` (constant) — the single source of truth for available names

## Data Storage

| Object/Model/Type | Field/Property | Purpose |
|--------|-------|---------|
| `SaagaConfig` | `unstableFeatures?` | Feature names from project config |
| `GlobalCliFlags` | `unstableFeature?` | Feature names from `--unstable-feature` (Commander accumulates into an array) |
| Process-wide set | `enabledFeatures` (internal) | Initialized by `initUnstableFeatures()`; queried via `isUnstableFeatureEnabled()` |

### Available Features

| Name | Description |
|------|-------------|
| `none` | No-op feature for verifying the unstable-feature plumbing |

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `src/unstable-features.ts` | `UNSTABLE_FEATURES` (constant) | Readonly tuple of known feature names |
| `src/unstable-features.ts` | `UnstableFeature` (type) | Union of names in `UNSTABLE_FEATURES` |
| `src/unstable-features.ts` | `isUnstableFeature()` | Type guard: string is a known feature name |
| `src/unstable-features.ts` | `findUnknownFeature()` | Returns the first unknown name, or `undefined` |
| `src/unstable-features.ts` | `resolveUnstableFeatures()` | Union config + CLI names, dedupe, preserve order |
| `src/unstable-features.ts` | `initUnstableFeatures()` | Replace the process-wide enabled set |
| `src/unstable-features.ts` | `isUnstableFeatureEnabled()` | Query whether a feature is currently enabled |
| `src/unstable-features.ts` | `getEnabledUnstableFeatures()` | Sorted array of currently enabled features (for warnings) |
| `src/unstable-features.ts` | `resetUnstableFeatures()` | Reset to empty set (test isolation only) |

## Resolution and Bootstrap

1. Every subcommand that needs config calls internal `bootstrapUnstableFeatures()` early.
2. Config is loaded; CLI `--unstable-feature` values are validated via `findUnknownFeature()`.
3. Unknown CLI names throw `UnstableFeatureError` (exit code 1, `[ERROR]` on stderr).
4. Unknown config names fail earlier in `loadConfig()` with `ConfigError`.
5. `resolveUnstableFeatures(config, cli)` unions sources (config first, then CLI).
6. `initUnstableFeatures(resolved)` sets the process-wide registry.
7. If any features are enabled, stderr receives: `[WARN] Unstable features enabled: <names>`.

## Reference Implementations

- `src/unstable-features.ts` — registry and process-wide enablement
- `src/cli/config.ts` — parses and validates `unstableFeatures` in config
- `src/cli.ts` — `--unstable-feature` flag, `bootstrapUnstableFeatures()`, error handling

## Related Concepts

- [Project Configuration](./project-configuration.md) — `unstableFeatures` config field
- [Adding Unstable Features](../patterns/adding-unstable-features.md) — how to register a new feature
