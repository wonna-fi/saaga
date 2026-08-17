# Project Configuration

## Business Definition

Project configuration is the mechanism by which a Saaga-managed project declares persistent default settings — backend, per-backend tiered model overrides, and rule targets — in a version-controlled YAML file. These settings serve as the second-priority source in every resolution chain: CLI flags override them, and built-in defaults fill in when they are absent.

## Configuration

| Source | Description |
|--------|-------------|
| `.saaga/config.yaml` | YAML file in the project directory containing all project-level settings |

**How to access:**

- `loadConfig(projectDir)` — reads and validates `.saaga/config.yaml` from the given directory; returns a `SaagaConfig` object (empty `{}` when the file does not exist)
- `CONFIG_DIR` (constant) — the directory name `".saaga"` where the config file lives
- `CONFIG_FILE` (constant) — the file name `"config.yaml"`
- `DEFAULT_DOCS_DIR` (constant) — `"saaga-docs"`, the default documentation directory name when `docsDir` is not configured

## Data Storage

| Object/Model/Type | Field/Property | Purpose |
|--------|-------|---------|
| `SaagaConfig` | `defaultBackend` | Optional backend name (`"cursor"`, `"copilot"`, or `"claude"`); used as fallback when `--backend` flag is absent |
| `SaagaConfig` | `backends` | Optional per-backend model tier overrides; a mapping from backend name to a `BackendModels` object |
| `SaagaConfig` | `ruleTargets` | Optional rule targets string; accepts a comma-separated string or a YAML list of strings; used as fallback when `--rule-targets` flag is absent |
| `SaagaConfig` | `docsDir` | Optional documentation directory name; overrides the default `"saaga-docs"` directory where BASELINE and metadata are stored |
| `SaagaConfig` | `autoApprove` | Optional boolean; when `true`, skips the interactive cost confirmation prompt before agent-backed commands (see [Cost Confirmation](./cost-confirmation.md)) |
| `SaagaConfig` | `unstableFeatures` | Optional array of known unstable feature names; unioned with `--unstable-feature` CLI flags (see [Unstable Features](./unstable-features.md)) |
| `BackendModels` | `modelLow` | Optional model string for the `low` quality tier |
| `BackendModels` | `modelMedium` | Optional model string for the `medium` quality tier |
| `BackendModels` | `modelHigh` | Optional model string for the `high` quality tier |

### Config File Example

```yaml
defaultBackend: cursor
backends:
  cursor:
    modelHigh: claude-4.6-opus-high-thinking
    modelMedium: cursor-grok-4.5-high
  claude:
    modelHigh: opus
ruleTargets: agentsmd,cursor
autoApprove: true
unstableFeatures: []
```

The `ruleTargets` field also accepts a YAML list:

```yaml
ruleTargets:
  - agentsmd
  - cursor
```

For projects that previously used the hardcoded `docs/` directory, set `docsDir` to preserve the existing path:

```yaml
docsDir: docs
```

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `src/cli/config.ts` | `loadConfig()` | Load and validate `.saaga/config.yaml`; returns `SaagaConfig` (empty object when file is absent) |
| `src/cli/config.ts` | `ConfigError` (class) | Error class thrown for malformed YAML or invalid field types |
| `src/cli/config.ts` | `SaagaConfig` (interface) | Shape of the parsed config: `defaultBackend?`, `backends?`, `ruleTargets?`, `docsDir?`, `autoApprove?`, `unstableFeatures?` |
| `src/cli/config.ts` | `BackendModels` (interface) | Per-backend model tier overrides: `modelLow?`, `modelMedium?`, `modelHigh?` |
| `src/cli/config.ts` | `CONFIG_DIR` (constant) | String `".saaga"` — directory containing the config file |
| `src/cli/config.ts` | `CONFIG_FILE` (constant) | String `"config.yaml"` — config file name |
| `src/cli/config.ts` | `DEFAULT_DOCS_DIR` (constant) | String `"saaga-docs"` — default documentation directory name |

## Internal Implementation

> Functions below are internal and should not be called directly. They are documented for understanding the internal logic.
>
> - `normalizeRuleTargets()` in `src/cli/config.ts` — converts `ruleTargets` from either a string or an array of strings into a single comma-separated string suitable for `parseRuleTargets()`
> - `parseBackends()` in `src/cli/config.ts` — validates the `backends` mapping and parses each entry via `parseBackendModels()`
> - `parseBackendModels()` in `src/cli/config.ts` — validates each `BackendModels` entry (`modelLow`, `modelMedium`, `modelHigh` must be strings)
> - `resolveRuleTargets()` in `src/cli.ts` — resolves the effective rule-target string from CLI flag → `config.ruleTargets` → default `"agentsmd"`, then validates via `parseRuleTargets()`
> - `resolveDocsDir()` in `src/cli.ts` — resolves the effective documentation directory from `config.docsDir` → `DEFAULT_DOCS_DIR` (`"saaga-docs"`)
> - `parseUnstableFeatures()` in `src/cli/config.ts` — validates `unstableFeatures` is a string array of known `UNSTABLE_FEATURES` names
> - `bootstrapUnstableFeatures()` in `src/cli.ts` — loads config, validates CLI feature names, initializes the process-wide registry, emits a warning when any are enabled

## Loading Behavior

1. **File absent**: `loadConfig()` returns an empty `SaagaConfig` (`{}`) — no error
2. **File present, empty content**: returns `{}` (null/undefined YAML values are treated as absent)
3. **Malformed YAML**: throws `ConfigError: "Failed to parse .saaga/config.yaml: <parse error>"`
4. **Non-mapping root** (e.g., an array or scalar): throws `ConfigError: ".saaga/config.yaml must be a YAML mapping, got <type>"`
5. **Invalid field type** (e.g., `defaultBackend: 123`): throws `ConfigError: ".saaga/config.yaml: 'defaultBackend' must be a string"`
6. **`backends` is not a mapping**: throws `ConfigError: ".saaga/config.yaml: 'backends' must be a YAML mapping"`
7. **Unknown backend key in `backends`**: throws `ConfigError: ".saaga/config.yaml: 'backends.<name>' is not a valid backend (must be 'cursor', 'copilot', or 'claude')"`
8. **`backends.<backend>` is not a mapping**: throws `ConfigError: ".saaga/config.yaml: 'backends.<backend>' must be a YAML mapping"`
9. **`backends.<backend>.modelLow/Medium/High` is not a string**: throws `ConfigError: ".saaga/config.yaml: 'backends.<backend>.<field>' must be a string"`
10. **Invalid `ruleTargets` type** (e.g., array containing non-strings): throws `ConfigError: ".saaga/config.yaml: 'ruleTargets' array items must be strings"`
11. **Invalid `ruleTargets` type** (e.g., a number): throws `ConfigError: ".saaga/config.yaml: 'ruleTargets' must be a string or array of strings"`
12. **Invalid `docsDir` type** (e.g., `docsDir: 123`): throws `ConfigError: ".saaga/config.yaml: 'docsDir' must be a string"`
13. **Invalid `autoApprove` type** (e.g., `autoApprove: "yes"`): throws `ConfigError: ".saaga/config.yaml: 'autoApprove' must be a boolean"`
14. **`unstableFeatures` is not an array**: throws `ConfigError: ".saaga/config.yaml: 'unstableFeatures' must be an array of strings"`
15. **`unstableFeatures` array contains non-string**: throws `ConfigError: ".saaga/config.yaml: 'unstableFeatures' array items must be strings"`
16. **Unknown feature in `unstableFeatures`**: throws `ConfigError: ".saaga/config.yaml: 'unstableFeatures' contains unknown feature '<name>' (available: ...)"`

## Resolution Chains

Config values participate in every resolution chain as the second-priority source:

| Setting | Resolution order |
|---------|-----------------|
| Backend | `--backend` flag → `config.defaultBackend` → `BackendError` |
| Model (high tier: init, update, verify-quick-updates) | `--model-high` flag → `config.backends.<backend>.modelHigh` → built-in default |
| Model (medium tier: quick-update) | `--model-medium` flag → `config.backends.<backend>.modelMedium` → built-in default |
| Model (low tier: doctor probes) | `--model-low` flag → `config.backends.<backend>.modelLow` → built-in default |
| Rule targets | `--rule-targets` flag → `config.ruleTargets` → `"agentsmd"` |
| Docs dir | `config.docsDir` → `DEFAULT_DOCS_DIR` (`"saaga-docs"`) |
| Auto-approve | `--yes` flag → `config.autoApprove` → `false` |
| Unstable features | Union of `config.unstableFeatures` then `--unstable-feature` flags (deduped; config first) → empty set |

## Error Handling

| Scenario | Error |
|----------|-------|
| Malformed YAML | `ConfigError: "Failed to parse .saaga/config.yaml: <message>"` |
| Root is not a mapping | `ConfigError: ".saaga/config.yaml must be a YAML mapping, got <type>"` |
| `defaultBackend` is not a string | `ConfigError: ".saaga/config.yaml: 'defaultBackend' must be a string"` |
| `backends` is not a mapping | `ConfigError: ".saaga/config.yaml: 'backends' must be a YAML mapping"` |
| Unknown backend key | `ConfigError: ".saaga/config.yaml: 'backends.<name>' is not a valid backend ..."` |
| Backend model field is not a string | `ConfigError: ".saaga/config.yaml: 'backends.<backend>.<field>' must be a string"` |
| `ruleTargets` is not a string or array | `ConfigError: ".saaga/config.yaml: 'ruleTargets' must be a string or array of strings"` |
| `ruleTargets` array contains non-string | `ConfigError: ".saaga/config.yaml: 'ruleTargets' array items must be strings"` |
| `docsDir` is not a string | `ConfigError: ".saaga/config.yaml: 'docsDir' must be a string"` |
| `autoApprove` is not a boolean | `ConfigError: ".saaga/config.yaml: 'autoApprove' must be a boolean"` |
| `unstableFeatures` is not an array of strings | `ConfigError: ".saaga/config.yaml: 'unstableFeatures' must be an array of strings"` |
| Unknown unstable feature name | `ConfigError: ".saaga/config.yaml: 'unstableFeatures' contains unknown feature '...'"` |

## Reference Implementations

- `src/cli/config.ts` — the canonical module containing config loading, validation, and type definitions
- `tests/cli/config.test.ts` — unit tests covering all validation paths, missing files, empty content, and type coercion
- `tests/cli/config-integration.test.ts` — integration tests for config loading with real file system

## Related Concepts

- [Backend Resolution](./backend-resolution.md) — uses `config.defaultBackend` and `config.backends` in the resolution chain
- [Cost Confirmation](./cost-confirmation.md) — uses `config.autoApprove` to skip the interactive cost prompt
- [Unstable Features](./unstable-features.md) — uses `config.unstableFeatures` in the enablement union
- [Saaga Rules](./saaga-rules.md) — separate project-root instructions file (not part of `config.yaml`)
