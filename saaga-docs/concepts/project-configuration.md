# Project Configuration

## Business Definition

Project configuration is the mechanism by which a Saaga-managed project declares persistent default settings — backend, model, quick model, and rule targets — in a version-controlled YAML file. These settings serve as the second-priority source in every resolution chain: CLI flags override them, and built-in defaults fill in when they are absent. This replaces the previous environment-variable-based fallback approach.

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
| `SaagaConfig` | `backend` | Optional backend name (`"cursor"`, `"copilot"`, or `"claude"`); used as fallback when `--backend` flag is absent |
| `SaagaConfig` | `model` | Optional AI model override for standard subcommands; used as fallback when `--model` flag is absent |
| `SaagaConfig` | `quickModel` | Optional AI model override for the `quick-update` subcommand; used instead of `defaultQuickModelFor(backend)` |
| `SaagaConfig` | `ruleTargets` | Optional rule targets string; accepts a comma-separated string or a YAML list of strings; used as fallback when `--rule-targets` flag is absent |
| `SaagaConfig` | `docsDir` | Optional documentation directory name; overrides the default `"saaga-docs"` directory where BASELINE and metadata are stored |

### Config File Example

```yaml
backend: cursor
model: claude-4.6-opus-high-thinking
quickModel: claude-4.6-sonnet-medium-thinking
ruleTargets: agentsmd,cursor
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
| `src/cli/config.ts` | `SaagaConfig` (interface) | Shape of the parsed config: `backend?`, `model?`, `quickModel?`, `ruleTargets?`, `docsDir?` |
| `src/cli/config.ts` | `CONFIG_DIR` (constant) | String `".saaga"` — directory containing the config file |
| `src/cli/config.ts` | `CONFIG_FILE` (constant) | String `"config.yaml"` — config file name |
| `src/cli/config.ts` | `DEFAULT_DOCS_DIR` (constant) | String `"saaga-docs"` — default documentation directory name |

## Internal Implementation

> Functions below are internal and should not be called directly. They are documented for understanding the internal logic.
>
> - `normalizeRuleTargets()` in `src/cli/config.ts` — converts `ruleTargets` from either a string or an array of strings into a single comma-separated string suitable for `parseRuleTargets()`
> - `resolveRuleTargets()` in `src/cli.ts` — resolves the effective rule-target string from CLI flag → `config.ruleTargets` → default `"agentsmd"`, then validates via `parseRuleTargets()`
> - `resolveDocsDir()` in `src/cli.ts` — resolves the effective documentation directory from `config.docsDir` → `DEFAULT_DOCS_DIR` (`"saaga-docs"`)

## Loading Behavior

1. **File absent**: `loadConfig()` returns an empty `SaagaConfig` (`{}`) — no error
2. **File present, empty content**: returns `{}` (null/undefined YAML values are treated as absent)
3. **Malformed YAML**: throws `ConfigError: "Failed to parse .saaga/config.yaml: <parse error>"`
4. **Non-mapping root** (e.g., an array or scalar): throws `ConfigError: ".saaga/config.yaml must be a YAML mapping, got <type>"`
5. **Invalid field type** (e.g., `backend: 123`): throws `ConfigError: ".saaga/config.yaml: 'backend' must be a string"`
6. **Invalid `ruleTargets` type** (e.g., array containing non-strings): throws `ConfigError: ".saaga/config.yaml: 'ruleTargets' array items must be strings"`
7. **Invalid `ruleTargets` type** (e.g., a number): throws `ConfigError: ".saaga/config.yaml: 'ruleTargets' must be a string or array of strings"`
8. **Invalid `docsDir` type** (e.g., `docsDir: 123`): throws `ConfigError: ".saaga/config.yaml: 'docsDir' must be a string"`

## Resolution Chains

Config values participate in every resolution chain as the second-priority source:

| Setting | Resolution order |
|---------|-----------------|
| Backend | `--backend` flag → `config.backend` → `BackendError` |
| Model (standard) | `--model` flag → `config.model` → `defaultModelFor(backend)` |
| Model (quick-update) | `--model` flag → `config.quickModel` → `defaultQuickModelFor(backend)` |
| Rule targets | `--rule-targets` flag → `config.ruleTargets` → `"agentsmd"` |
| Docs dir | `config.docsDir` → `DEFAULT_DOCS_DIR` (`"saaga-docs"`) |

## Error Handling

| Scenario | Error |
|----------|-------|
| Malformed YAML | `ConfigError: "Failed to parse .saaga/config.yaml: <message>"` |
| Root is not a mapping | `ConfigError: ".saaga/config.yaml must be a YAML mapping, got <type>"` |
| `backend` is not a string | `ConfigError: ".saaga/config.yaml: 'backend' must be a string"` |
| `model` is not a string | `ConfigError: ".saaga/config.yaml: 'model' must be a string"` |
| `quickModel` is not a string | `ConfigError: ".saaga/config.yaml: 'quickModel' must be a string"` |
| `ruleTargets` is not a string or array | `ConfigError: ".saaga/config.yaml: 'ruleTargets' must be a string or array of strings"` |
| `ruleTargets` array contains non-string | `ConfigError: ".saaga/config.yaml: 'ruleTargets' array items must be strings"` |
| `docsDir` is not a string | `ConfigError: ".saaga/config.yaml: 'docsDir' must be a string"` |

## Reference Implementations

- `src/cli/config.ts` — the canonical module containing config loading, validation, and type definitions
- `tests/cli/config.test.ts` — unit tests covering all validation paths, missing files, empty content, and type coercion
- `tests/cli/config-integration.test.ts` — integration tests for config loading with real file system

## Related Concepts

- [Backend Resolution](./backend-resolution.md) — uses `config.backend`, `config.model`, and `config.quickModel` in the resolution chain
