# Adding CLI Subcommands

## When to Use

Use this pattern when you need to add a new top-level subcommand to the `saaga` CLI. Each subcommand typically loads a flow YAML file and executes it with an initial scope and dependencies.

## Pattern

```typescript
// In src/cli.ts — add a new subcommand block after the existing ones:

program
  .command("my-command")
  .description("Short description of what this command does")
  .argument("[dir]", "Path to the application directory (default: cwd)", ".")
  .action(async (dir: string, _cmdOpts: unknown, cmd) => {
    const globals = cmd.optsWithGlobals() as GlobalCliFlags;
    await runFlowSubcommand({
      dir,
      flowName: "my-command",       // must match flows/my-command.flow.yaml
      subcommand: "my-command",     // embedded in the run ID
      globals,
      options,
    });
  });
```

### Steps

1. **Define the subcommand** in `src/cli.ts` using `program.command()` from Commander. Use `.argument()` for positional args and `.option()` for command-specific flags.

2. **Create a flow file** at `flows/my-command.flow.yaml` defining the step sequence. The flow receives the initial scope variables set by the subcommand handler.

3. **Wire the handler** to `runFlowSubcommand()` for standard directory-based subcommands. This internal helper:
   - Resolves and validates the `dir` argument (must exist, must be a directory; defaults to cwd when omitted)
   - Extracts the app name from the directory path via `basename()`
   - Resolves the agent via backend resolution
   - Creates a run context with `createRunContext()`
   - Loads the flow via `loadFlow(flowName)`
   - Executes the flow via `runFlow()` with initial scope: `{ app, app_path, run_id, run_dir, date }`

4. **For non-standard subcommands** (e.g., `slice` which takes a plan file instead of a directory), write a dedicated handler function following the same pattern: validate inputs → resolve agent → create/derive run context → load flow → run flow.

### Initial Scope Variables

Standard subcommands (`architecture`, `init`, `update`, `quick-update`, `verify-quick-updates`) inject these variables into the flow scope:

| Variable | Source | Description |
|----------|--------|-------------|
| `app` | `basename(appPath)` | Application directory name |
| `app_path` | `resolve(baseCwd, dir)` | Absolute path to the application |
| `run_id` | `createRunContext()` | Unique run identifier |
| `run_dir` | `createRunContext()` | Absolute path to the run directory |
| `date` | `createRunContext()` | Run date formatted as YYYYMMDD |

The `slice` subcommand uses a different initial scope:

| Variable | Source | Description |
|----------|--------|-------------|
| `plan` | `resolve(baseCwd, plan)` | Absolute path to the plan file |
| `phase_number` | CLI argument (parsed as integer) | Phase number to document |
| `run_id` | Derived or generated | Run identifier |
| `run_dir` | Derived or generated | Run directory path |

## Key Points

- All subcommands share the global flags: `--backend`, `--model`, `--ci`
- The `flowName` argument to `loadFlow()` must match a file at `flows/<flowName>.flow.yaml`
- Input validation (directory/file existence checks) happens before agent resolution, so credential errors are not thrown for invalid paths
- The program uses `exitOverride()` so `AgentStepFailedError` can be caught and its `exitCode` returned instead of calling `process.exit()` directly

## Reference Implementations

| File | Function/Pattern | Notes |
|------|-----------------|-------|
| `src/cli.ts` | `architecture` subcommand | Simplest case: single optional `[dir]` argument (defaults to cwd), delegates to `runFlowSubcommand()` |
| `src/cli.ts` | `slice` subcommand | Complex case: takes `<plan>` and `<phase>` args, derives run dir from plan path, custom handler `runSliceSubcommand()` |
| `tests/cli/help-version.test.ts` | CLI flag tests | Verifies `--help` lists all subcommands and global flags |

## Anti-Patterns

**Do NOT:**

- Call `process.exit()` directly — use `exitOverride()` and let errors propagate. The main entry point handles exit codes.
- Skip input validation — always verify the target path exists before resolving the agent to avoid confusing credential errors on bad paths.
- Hard-code the flow file path — use `loadFlow(name)` which resolves relative to `FLOWS_DIR`.
- Export internal handler functions — `runFlowSubcommand()` and `runSliceSubcommand()` are intentionally internal. Only `runCli()` and `CliOptions` are part of the public API.
