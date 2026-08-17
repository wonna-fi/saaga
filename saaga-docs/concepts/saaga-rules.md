# Saaga Rules (`.saagarules`)

## Business Definition

`.saagarules` is an optional project-root file that supplies additional documentation instructions and context. When present, its content is loaded once at the start of an agent-backed workflow and appended to every agent prompt. Instructions are treated as high priority for documentation content, but they do not override required output formats, file paths, workflow control instructions, or safety/permission constraints.

## Configuration

| Source | Description |
|--------|-------------|
| `.saagarules` | Plain UTF-8 text/Markdown file at the project (app) root |

**How to access:**
- `loadSaagaRules(projectRoot)` — reads and validates the file; returns `undefined` when absent or whitespace-only
- `appendSaagaRules(prompt, rules)` — appends a bounded-priority wrapper plus rules to a rendered prompt; returns the prompt unchanged when `rules` is undefined
- `SAAGA_RULES_FILE` (constant) — `".saagarules"`

## Data Storage

| Object/Model/Type | Field/Property | Purpose |
|--------|-------|---------|
| File | `.saagarules` | User-authored instructions at the app root (not under `saaga-docs/`) |
| `RunFlowDeps` | `saagaRules?` | Pre-loaded snapshot passed from the CLI into the flow engine |

There is no structured schema: content is raw text. No `{var}` placeholder expansion is performed inside the file.

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `src/saaga-rules.ts` | `loadSaagaRules()` | Load and validate `.saagarules`; returns content or `undefined` |
| `src/saaga-rules.ts` | `appendSaagaRules()` | Append rules to a prompt with an explicit priority wrapper |
| `src/saaga-rules.ts` | `SaagaRulesError` (class) | Thrown on size overflow, invalid UTF-8, or I/O failures other than missing file |
| `src/saaga-rules.ts` | `SAAGA_RULES_FILE` (constant) | String `".saagarules"` |

## Behavior

1. **Load timing**: `runFlowSubcommand()` calls `loadSaagaRules(appPath)` once before `runFlow()`. Edits during a run have no effect.
2. **Injection**: Each agent step renders its prompt template, then calls `appendSaagaRules(rendered, deps.saagaRules)`.
3. **Missing / empty**: Absent file or whitespace-only content → `undefined` → no injection, no error.
4. **Size limit**: Files larger than 64 KiB throw `SaagaRulesError`.
5. **Encoding**: Invalid UTF-8 throws `SaagaRulesError` (never silently omitted).
6. **Scope**: Only the target project root is checked; ancestor directories are not searched.
7. **Baseline**: `.saagarules` is hard-excluded from `computeManifest()`, so editing it alone does not trigger change detection.
8. **Permissions**: Under restricted mode, `.saagarules` is on the deny list (same class of protection as `AGENTS.md`).

## Reference Implementations

- `src/saaga-rules.ts` — load/validate/append
- `src/cli.ts` — loads rules and passes `saagaRules` in `RunFlowDeps`
- `src/engine/runner.ts` — appends rules in `runAgentStep()`
- `src/agent/permissions.ts` — denies write/access to `.saagarules` in the default profile
- `src/scripts/file-manifest.ts` — hard-excludes `.saagarules` from manifests

## Related Concepts

- [Templates and Prompt Rendering](./templates-and-prompt-rendering.md) — prompt rendering happens before rules are appended
- [Agent Permissions and Restriction](./agent-permissions.md) — deny-list protection for `.saagarules`
- [Baseline and Change Detection](./baseline-and-change-detection.md) — manifest exclusion
- [Project Configuration](./project-configuration.md) — separate from `.saaga/config.yaml`
