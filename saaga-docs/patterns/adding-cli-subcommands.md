# Adding CLI Subcommands

## When to Use

Use this pattern when you need to expose new behavior through the `saaga` CLI. Prefer adding a **bundled flow** (picked up automatically by `saaga run`) over a new top-level Commander command. Add a dedicated top-level subcommand only for non-flow operations (like `install-rules` or `doctor`).

## Pattern

### Preferred: add a flow for `saaga run`

```yaml
# flows/my-command.flow.yaml
name: my-command
description: >-
  Short summary shown when the user runs `saaga run` with no flow name.
steps:
  - script:
      name: detect-changes
      label: detecting changes
      app_dir: ${app_path}
      docs_dir: ${docs_dir}
      set: changes
  # ... additional steps
```

No `src/cli.ts` change is required: `listFlows()` discovers `*.flow.yaml` under `FLOWS_DIR`, and `saaga run my-command [dir]` loads it via `loadFlow("my-command")` → `runFlowSubcommand()`.

### Optional: dedicated top-level command (non-flow)

```typescript
// In src/cli.ts — only when the operation is not a flow (e.g. install-rules, doctor):

program
  .command("my-utility")
  .description("Short description of what this command does")
  .argument("[dir]", "Path to the application directory (default: cwd)", ".")
  .action(async (dir: string, _cmdOpts: unknown, cmd) => {
    const globals = cmd.optsWithGlobals() as GlobalCliFlags;
    // validate inputs → resolve config → execute operation
  });
```

### Steps

1. **Create a flow file** at `flows/my-command.flow.yaml` with `name`, optional `description`, and `steps`. The `description` appears in `saaga run` (no args) via `listFlows()`.

2. **Exercise it** with `saaga run my-command [dir]`. The shared `runFlowSubcommand()` handler:
   - Resolves and validates the `dir` argument (must exist, must be a directory; defaults to cwd when omitted)
   - Extracts the app name from the directory path via `basename()`
   - Resolves the agent via backend resolution (`medium` model key only when the flow name is `quick-update`; otherwise `high`)
   - Shows the cost notice naming `saaga run <flow>`
   - Creates a run context with `createRunContext()` (flow name embedded in the run ID)
   - Loads the flow via `loadFlow(flowName)`
   - Executes the flow via `runFlow()` with initial scope: `{ app, app_path, docs_dir, run_id, run_dir, date }`

3. **For non-flow utilities** (e.g., `install-rules`), write a dedicated handler: validate inputs → resolve config → execute operation. Do not register a parallel top-level alias for a flow — former flow commands are hidden stubs that throw `DeprecatedCommandError` pointing users to `saaga run <flow>`.

### Initial Scope Variables

`saaga run <flow>` injects these variables into the flow scope:

| Variable | Source | Description |
|----------|--------|-------------|
| `app` | `basename(appPath)` | Application directory name |
| `app_path` | `resolve(baseCwd, dir)` | Absolute path to the application |
| `docs_dir` | `resolveDocsDir(config)` | Documentation directory name |
| `run_id` | `createRunContext()` | Unique run identifier |
| `run_dir` | `createRunContext()` | Absolute path to the run directory |
| `date` | `createRunContext()` | Run date formatted as YYYYMMDD |

## Key Points

- All flow runs share the global flags: `--backend`, `--model`, `--ci`, `--yes`, etc.
- The flow name must match `flows/<name>.flow.yaml` (and the YAML `name:` field used by `listFlows()`)
- Input validation (directory existence) happens before agent resolution, so credential errors are not thrown for invalid paths
- The program uses `exitOverride()` so `AgentStepFailedError` and `DeprecatedCommandError` can be caught and their exit codes returned

## Reference Implementations

| File | Function/Pattern | Notes |
|------|-----------------|-------|
| `flows/*.flow.yaml` | Bundled flows | Discovered by `listFlows()`; executed via `saaga run <name>` |
| `src/cli.ts` | `run` subcommand | Lists flows or delegates to `runFlowSubcommand()`; `--rule-targets` for `init` |
| `src/cli.ts` | Hidden legacy stubs | `init` / `update` / `quick-update` / `verify-quick-updates` throw `DeprecatedCommandError` |
| `src/cli.ts` | `install-rules` subcommand | Non-flow case: validates dir, calls `installRules()` directly without backend/run context |
| `tests/cli/run.test.ts` | `saaga run` listing / deprecation tests | Verifies flow listing (including descriptions) and migration stubs |

## Anti-Patterns

**Do NOT:**

- Add a new top-level Commander command that merely wraps an existing flow — use `saaga run <flow>` instead
- Call `process.exit()` directly — use `exitOverride()` and let errors propagate. The main entry point handles exit codes.
- Skip input validation — always verify the target path exists before resolving the agent to avoid confusing credential errors on bad paths.
- Hard-code the flow file path — use `loadFlow(name)` which resolves relative to `FLOWS_DIR`.
- Export internal handler functions — `runFlowSubcommand()` and `runInstallRulesSubcommand()` are intentionally internal. Only `runCli()` and `CliOptions` are part of the public API.
