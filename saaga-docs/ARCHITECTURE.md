# Architecture — Saaga

`saaga` is a CLI tool that orchestrates AI coding agents (Cursor, GitHub Copilot, Claude) to generate and maintain domain documentation for software projects. It executes declarative YAML workflows that combine agent invocations, built-in scripts, and control-flow primitives.

## Overall Architecture

The system is structured as a pipeline:

```
CLI (commander) → Backend/Agent resolution → Flow loading → Flow engine execution
```

1. The **CLI** parses subcommands and global flags, resolves the agent backend, and creates a run context (unique ID + output directory).
2. The **Flow Loader** reads the YAML flow file for the chosen subcommand.
3. The **Flow Engine** executes each step sequentially. Steps can invoke an agent with a rendered prompt, call a built-in script, or use control-flow primitives (`foreach`, `loop`, `if`, `read-file`).
4. **Agent adapters** shell out to external CLI tools (`cursor-agent`, `copilot`, `claude`) to perform AI-driven work.
5. **Built-in scripts** handle structured data operations (plan parsing, change detection, baseline generation, rule installation) that are better expressed in code than in agent prompts.

### Data Flow

```mermaid
flowchart TD
    A[CLI Subcommand] --> B[Resolve Agent Backend]
    A --> C[Create Run Context]
    B --> D[Load Flow YAML]
    C --> D
    D --> E[Flow Engine]
    E --> F{Step Type?}
    F -->|agent| G[Render Prompt Template]
    G --> H[Agent Adapter]
    H --> I[External Agent CLI]
    F -->|script| J[Script Registry]
    J --> K[Built-in Script]
    F -->|foreach / loop / if| L[Control Flow]
    L --> E
    F -->|read-file| M[Read File into Scope]

    style A fill:#4A90D9,color:#fff
    style E fill:#7B68EE,color:#fff
    style H fill:#3CB371,color:#fff
    style K fill:#DAA520,color:#fff
```

### Key Design Decisions

- **Declarative orchestration**: Workflow logic lives in YAML flow files, not application code. Adding or reordering steps requires no code changes.
- **Agent-agnostic**: The `Agent` interface abstracts over backends. The engine never references a specific agent implementation.
- **Scope-based data flow**: All inter-step communication flows through a mutable scope dictionary. Steps read from and write to scope variables using `${var}` expressions.
- **Run isolation**: Each invocation gets a unique run directory under `$SAAGA_DIR/runs/<run-id>/` for plans, reviews, and status files.
- **No git dependency**: File manifests, hashing, and change detection are implemented in pure Node.js. No git CLI is required at runtime.

## Modules

### CLI (`src/cli.ts`)

Entry point. Defines five subcommands (`init`, `install-rules`, `update`, `quick-update`, `verify-quick-updates`) using `commander`. Four of these resolve the agent, create a run context, load the corresponding flow, and call the engine. The `install-rules` subcommand is standalone: it runs the rule installer directly without an agent backend.

Global flags include `--backend`, `--model`, `--ci`, `--verbose`, and `--yes` (`-y`). The `--verbose` flag enables detailed step output and live agent output on the terminal. The `--yes` flag skips the cost confirmation prompt for agent-backed commands.

`runFlowSubcommand()` calls `confirmAgentCosts()` before creating the run context. The cost notice uses `backendCliCommand()` to determine the CLI binary name, or falls back to the agent's `name` when the agent was injected directly. After confirmation, it creates a `logFile` path (`resolve(runCtx.runDir, "run.log")`) and passes both `logFile` and `verbose` (from the `--verbose` flag) to `RunFlowDeps`, which the engine uses for output routing. It also logs `buildCostSummary()` as a detail line to the run log.

`createLogger()` accepts an optional `logFile` parameter and the `verbose` flag, forwarding them to the `Logger` constructor (which delegates to `OutputSink`).

**Exports**: `runCli(argv, options): Promise<number>`, `CliOptions`

`CliOptions` fields: `agent?: Agent` (injected agent for tests), `cwd?: string`, `env?: NodeJS.ProcessEnv`, `stdout?: NodeJS.WritableStream`, `stderr?: NodeJS.WritableStream`, `stdin?: NodeJS.ReadableStream` (used by cost confirmation prompt in tests).

Error handling catches `AgentStepFailedError` (returns exit code), `ConfirmationDeclinedError` (writes message to stderr, returns exit code 1), and Commander info exits (version/help, returns 0).

> **Internal implementation:**
>
> - `resolveAgent()` returns a `ResolvedAgent` containing the `Agent` plus optional `backend` and `model` fields (absent when the agent was injected via `CliOptions.agent`). These resolution details are passed to `confirmAgentCosts()` for the cost notice.
> - `isInteractive()` is not in this module — it lives in `cli/confirm.ts`.

**Dependencies**: `cli/config`, `cli/backend`, `cli/confirm`, `engine/loader`, `engine/runner`, `run-context`, `logger`, `paths`, `scripts/install-rules`

### Config (`src/cli/config.ts`)

Loads and validates project-level configuration from `.saaga/config.yaml`. Returns an empty config object when the file does not exist, enabling zero-config usage. Throws `ConfigError` on malformed YAML or invalid field types.

**Exports**: `loadConfig(projectDir): Promise<SaagaConfig>`, `SaagaConfig` interface, `ConfigError` class, `CONFIG_DIR` (constant: `".saaga"`), `CONFIG_FILE` (constant: `"config.yaml"`), `DEFAULT_DOCS_DIR` (constant: `"saaga-docs"`)

**`SaagaConfig` fields**: `backend?: string`, `model?: string`, `quickModel?: string`, `ruleTargets?: string`, `docsDir?: string`, `autoApprove?: boolean`

**Dependencies**: `yaml` (npm package)

### Backend (`src/cli/backend.ts`)

Resolves which agent backend to use and constructs the concrete `Agent` instance.

**Exports**: `resolveBackend(input): Backend`, `defaultModelFor(backend): string`, `defaultQuickModelFor(backend): string`, `backendCliCommand(backend): string`, `createAgent(opts): Agent`, `Backend` type, `BackendError`, `ResolveBackendInput`, `CreateAgentOptions`

`backendCliCommand()` returns the CLI binary name that Saaga executes for a given backend (e.g. `"cursor-agent"` for cursor, `"copilot"` for copilot, `"claude"` for claude). Used by the CLI to populate the cost notice.

> **Internal constant:** `BACKEND_CLI_COMMANDS` — a `Record<Backend, string>` mapping each backend to its CLI command name.

**Resolution precedence**: `--backend` flag → `.saaga/config.yaml` `backend` field → error.

`ResolveBackendInput` carries `flag?: string` (from CLI `--backend`) and `config?: string` (from `.saaga/config.yaml` `backend` field).

**Dependencies**: `agent/copilot-agent`, `agent/cursor-agent`, `agent/claude-agent`, `agent/types`

### Confirm (`src/cli/confirm.ts`)

Handles the cost confirmation prompt shown before agent-backed subcommands start. Displays a cost disclaimer naming the backend CLI and model, reminds the user that agent usage is billed to their own account, and on interactive terminals asks for `y/N` confirmation. Non-interactive invocations (piped stdin, `--ci`) print the notice and continue without blocking. The prompt can be skipped entirely via `--yes` flag or `autoApprove: true` in config.

**Exports**: `confirmAgentCosts(input): Promise<void>`, `buildCostNotice(input): string`, `buildCostSummary(input): string`, `ConfirmationDeclinedError` class, `CostNoticeInput` interface, `CostConfirmationInput` interface

`CostNoticeInput` fields: `subcommand: string`, `appPath: string`, `backendCli: string`, `backend?: string`, `model?: string`

`CostConfirmationInput` extends `CostNoticeInput` with: `autoApprove: boolean`, `ci: boolean`, `stdin?: NodeJS.ReadableStream`, `stream: NodeJS.WritableStream`

`ConfirmationDeclinedError` carries `exitCode = 1` and a default message of `"aborted: cost confirmation declined"`.

> **Internal implementation:**
>
> - `COST_HINTS` — a `Record<string, string>` mapping each agent-backed subcommand (`init`, `update`, `quick-update`, `verify-quick-updates`) to a human-readable cost expectation sentence appended to the notice.
> - `isInteractive(input)` — returns `false` when `ci` is true, `stdin` is absent, or `stdin.isTTY` is not true.
> - `ask(input)` — opens a `readline` interface and races the user's answer against an EOF/close event. Only `"y"` or `"yes"` (case-insensitive) is accepted.
> - `describeResolution(input)` — formats the `(backend X, model Y)` suffix for the notice text.

**Dependencies**: `node:readline/promises` (Node.js built-in)

### Agent (`src/agent/`)

Defines the `Agent` interface and its implementations. Each adapter shells out to an external CLI binary.

#### Interface (`src/agent/types.ts`)

```typescript
interface Agent {
  name: string;
  run(prompt: string, opts: AgentRunOpts): Promise<AgentRunResult>;
}
```

`AgentRunOpts` carries `cwd`, an optional `AbortSignal`, `additionalDirs?: string[]` (extra directories the agent must be able to access, e.g. the Saaga run directory), `logFile?: string` (absolute path to append the agent's stdout/stderr to), and `echo?: boolean` (also mirror output to the terminal under `--verbose`). `AgentRunResult` carries `exitCode`.

All three real adapters use an internal `buildStdio(opts)` helper to configure child-process I/O routing. When `logFile` is set, stdout/stderr are redirected to the log file (appended). When `echo` is also true, output is tee'd to both the terminal and the log file. When neither is set, `stdio: "inherit"` is used as a fallback.

#### CursorAgent (`src/agent/cursor-agent.ts`)

Invokes `cursor-agent --print --force --model <model> --output-format text`. The `--output-format text` flag is unconditional (always passed). Uses `buildStdio(opts)` for log-file capture.

#### CopilotAgent (`src/agent/copilot-agent.ts`)

Invokes `copilot -p <prompt> --allow-all-tools --no-ask-user --model <model> --no-auto-update`. Passes `--add-dir <dir>` for each entry in `opts.additionalDirs`, granting the agent access to directories outside `cwd` (e.g. the Saaga run directory). Temporarily renames `.gitignore` to `.gitignore.<random-hex>.bak` before invocation (Copilot's indexer respects `.gitignore`, which can hide files needed during documentation runs). The random suffix (8 hex characters from `randomBytes(4)`) prevents collisions between concurrent agent runs in the same directory. Uses `buildStdio(opts)` for log-file capture.

#### ClaudeAgent (`src/agent/claude-agent.ts`)

Invokes `claude --print --dangerously-skip-permissions --model <model>`. The `ci` field is stored in the constructor but is not currently used in CLI argument construction. Uses `buildStdio(opts)` for log-file capture.

#### FakeAgent (`src/agent/fake-agent.ts`)

Test double. Returns canned results keyed by substring match against the prompt. Records all calls (including `additionalDirs`) for assertion. Supports optional side-effect callbacks to simulate file writes.

### Engine (`src/engine/`)

The flow execution engine. Loads YAML flow definitions, evaluates expressions, and dispatches steps.

#### Types (`src/engine/types.ts`)

Defines the flow DSL type system:

| Type | Fields |
|------|--------|
| `FlowDefinition` | `name`, `steps: Step[]` |
| `AgentStep` | `prompt`, `vars?`, `expect_file?`, `label?` |
| `ScriptStep` | `name`, `args`, `set?`, `label?` |
| `ForeachStep` | `var`, `in`, `when?`, `do: Step[]`, `label?` |
| `LoopStep` | `max`, `until`, `do: Step[]`, `label?` |
| `IfStep` | `condition`, `then: Step[]`, `label?`, `skip_label?` |
| `ReadFileStep` | `path`, `set`, `trim?`, `label?` |

All step types support an optional `label` field used for phase progress display (interpolated against scope via `${var}` expressions). `IfStep` additionally has `skip_label`, shown in the `[SKIP]` line when the condition is false.

`Step` is the discriminated union of all step types. `Scope` is `Record<string, unknown>`.

#### Loader (`src/engine/loader.ts`)

Reads a `.flow.yaml` file from the `flows/` directory, parses YAML, and validates the structure into a `FlowDefinition`.

**Exports**: `loadFlow(name): Promise<FlowDefinition>`, `loadFlowFromFile(path)`, `parseFlowDefinition(raw)`

#### PhaseTracker (`src/engine/phases.ts`)

Tracks the flat phase index N and dynamically computes the total M for `Phase N/M` progress display. A "phase" is a user-visible unit of work: agent steps, script steps, foreach iterations (one per surviving item after `when` filtering), and skipped if-blocks (one `[SKIP]` line). `read-file` and `loop` steps are plumbing and produce no phase line.

The tracker dynamically recomputes the total by resolving `foreach.in` arrays from scope and evaluating `when` predicates. If a source array has not yet been resolved, `total()` returns `null` and the counter displays `?` (e.g. `Phase 1/?`).

**Exports**: `PhaseTracker` class

Key methods: `advance()` (increments the 1-indexed phase counter), `recordIfOutcome(step, taken)` (records whether an `if` was taken or skipped), `total(scope)` (computes total phases given current scope, returns `null` if indeterminate), `formatCounter(scope)` (returns e.g. `"Phase 7/16"`).

#### Runner (`src/engine/runner.ts`)

Executes a `FlowDefinition` by iterating its steps. Creates a `PhaseTracker` at the start and emits phase progress lines via `Logger.phaseBegin()` / `phaseEnd()` / `phaseImmediate()` calls instead of verbose INFO-banner logging. Dispatches each step by type to the appropriate handler. For `agent` steps: renders the prompt template, invokes `Agent.run()` with `additionalDirs` (the run directory from scope) and `logFile`/`echo` from deps, and optionally asserts that an expected output file exists. On agent failure, prints a tail of the log file for diagnostics.

**Exports**: `runFlow(flow, initialScope, deps)`, `RunFlowDeps`, `AgentStepFailedError`, `ExpectFileMissingError`

`RunFlowDeps` bundles the `Agent`, working directory, optional script registry override, an optional `logger?: Logger`, `logFile?: string` (absolute path to the run log file for agent output capture), and `verbose?: boolean` (mirror agent output to terminal). When `logger` is omitted, a silent logger (no-op sink) is used so library callers and tests don't get noise.

#### Expression (`src/engine/expression.ts`)

Handles `${var}` interpolation and predicate evaluation used by `when:`, `until:`, and `if:` clauses.

**Exports**:
- `interpolate(template, scope): string` — replaces `${var.field}` references with string-coerced scope values.
- `resolveValue(expr, scope): unknown` — like `interpolate`, but preserves raw types for sole-reference expressions (needed for `foreach.in` to receive arrays).
- `evaluatePredicate(expr, scope): boolean` — supports `==`, `!=`, `<`, `>`, `<=`, `>=` operators and bare truthy checks.

#### Primitives (`src/engine/primitives/`)

Each control-flow step type has a dedicated handler. All receive a `StepDispatcher` callback to recurse into child steps, avoiding circular imports with the runner.

| Primitive | Behavior |
|-----------|----------|
| `foreach` | Resolves `in` to an array, binds each item to `var` in scope, optionally filters with `when`, executes `do` body. Restores previous scope binding on completion. |
| `loop` | Runs `do` body up to `max` times. Sets `${iteration}` (1-indexed). Exits early when `until` predicate is true. |
| `if` | Executes `then` body when `condition` is true. No `else` branch. |
| `read-file` | Reads a file (path supports `${...}` interpolation) and binds UTF-8 content to a scope variable. Optional `trim`. |
| `script` | Looks up a handler in the script registry, interpolates args, calls it, and optionally binds the return value to a scope variable. |

### Scripts (`src/scripts/`)

Built-in script handlers invoked by `script` steps. Registered in a `ScriptRegistry` map.

#### Registry (`src/scripts/registry.ts`)

**Exports**: `defaultScriptRegistry: ScriptRegistry`, `ScriptHandler` type, `ScriptContext` type

The default registry maps: `"parse-plan"` → `parsePlan`, `"detect-changes"` → `detectChanges`, `"generate-baseline"` → `generateBaseline`, `"archive-quick-update"` → `archiveQuickUpdate`, `"collect-quick-updates"` → `collectQuickUpdates`, `"remove-quick-updates"` → `removeQuickUpdates`, `"install-rules"` → `installRules`.

#### parse-plan (`src/scripts/parse-plan.ts`)

Reads a plan file, extracts YAML frontmatter, and returns `Phase[]` (each with `number` and `title`). Used by `init`, `update`, and `verify-quick-updates` flows to drive the `foreach` loop over phases.

#### detect-changes (`src/scripts/detect-changes.ts`)

Compares the current work tree against `<app>/<docs_dir>/BASELINE`. Classifies differences as: changed, new, truly deleted, newly ignored. Writes a markdown report to `<output_dir>/changes.md` and returns counts. The `update` and `quick-update` flows use `${changes.count}` to skip work when nothing changed.

#### generate-baseline (`src/scripts/generate-baseline.ts`)

Writes `<app>/<docs_dir>/BASELINE` containing a `# Generated:` timestamp header and one `<hash> <path>` line per in-scope file, excluding `<docsDir>/`, `.saagaignore`, `.git/`, and any path matched by `.gitignore`/`.saagaignore` patterns. Hashes are computed locally without git CLI.

#### file-manifest (`src/scripts/file-manifest.ts`)

Shared utility used by `detect-changes` and `generate-baseline`. Recursively walks an application directory, honoring nested `.gitignore` and `.saagaignore` files at every directory level with "deepest match wins" semantics (via the `ignore` npm package). Accepts `(appDir, docsDir)` parameters to know which top-level directory to hard-exclude. Returns a sorted `FileEntry[]` with SHA-1 git blob hashes computed locally. No git CLI required.

Symlinks are included as manifest entries and hashed git-style (hash of the link target path string, not the linked file's content). Symlinked directories are not traversed.

**Exports**: `computeManifest()`, `gitBlobHash()`, `fileExists()`, `FileEntry`

#### archive-quick-update (`src/scripts/archive-quick-update.ts`)

Copies the detect-changes report into the quick-update metadata folder. Validates that a `summary_path` (if provided) exists on disk before archiving, preventing incomplete artifacts.

**Exports**: `archiveQuickUpdate()`, `ArchiveQuickUpdateArgs`

#### collect-quick-updates (`src/scripts/collect-quick-updates.ts`)

Snapshots all quick-update metadata folders and writes a JSON manifest listing their IDs. Used by `verify-quick-updates` to capture the set of artifacts to process.

**Exports**: `collectQuickUpdates()`, `CollectQuickUpdatesArgs`, `CollectQuickUpdatesResult`

#### remove-quick-updates (`src/scripts/remove-quick-updates.ts`)

Deletes exactly the quick-update metadata folders listed in a manifest. Folders created after the snapshot are preserved. Includes path-traversal defense.

**Exports**: `removeQuickUpdates()`, `RemoveQuickUpdatesArgs`

#### install-rules (`src/scripts/install-rules.ts`)

Installs always-on documentation rule stubs into an application directory. Supports four rule targets (`agentsmd`, `cursor`, `claude`, `copilot`) plus `none`. Shared-file targets (`agentsmd`, `claude`) use managed-block upsert between `<!-- saaga:begin/end -->` markers. Owned-file targets (`cursor`, `copilot`) overwrite the file using a wrapper template from `rules/`.

**Exports**: `installRules()`, `parseRuleTargets()`, `InstallRulesArgs`, `RULE_TARGETS`, `RuleTarget`, `MANAGED_BLOCK_BEGIN`, `MANAGED_BLOCK_END`

`InstallRulesArgs` fields: `app_dir: string`, `app: string`, `rule_targets: string`, `docs_dir: string`

### Templates (`src/templates.ts`)

Renders prompt files by substituting `{key}` placeholders with provided variables.

**Exports**: `renderPrompt(template, vars, options): string`, `renderPromptFile(path, vars, options): Promise<string>`, `MissingTemplateVariableError`, `TemplateFileNotFoundError`

Unmatched placeholders are left intact by default (prompts use `{Type}` as literal documentation). Strict mode is available for testing.

### Run Context (`src/run-context.ts`)

Generates a unique run ID and creates the run output directory. Also provides a `date` field (formatted as YYYYMMDD) for use in date-stamped output filenames.

**Exports**: `createRunContext(input): Promise<RunContext>`, `RunContext`, `CreateRunContextInput`

**ID format**: `<app>-<subcommand>-<YYYYMMDD>-<HHMMSS>-<8 hex chars>`

**Directory**: `$SAAGA_DIR/runs/<run-id>/` (defaults to `$HOME/.saaga/runs/`)

### Paths (`src/paths.ts`)

Resolves package-root-relative directory constants.

**Exports**: `PACKAGE_ROOT`, `FLOWS_DIR`, `PROMPTS_DIR`, `RULES_DIR`

Works identically whether running from `src/` (via `tsx`) or `dist/` (compiled).

### Logger (`src/logger.ts`)

Facade over `OutputSink` that provides the runner-facing logging API. The `Logger` constructor creates an `OutputSink` internally; alternatively, `Logger.fromSink(sink, opts)` wraps an existing `OutputSink` (used by `child()` to share the same sink across nested scopes).

**Exports**: `Logger` class, `LoggerOptions`, `silentLogger()` function

`LoggerOptions` fields: `ci?: boolean` (plain text mode, default `false`), `stream?: NodeJS.WritableStream` (output target, default `process.stderr`), `indent?: number` (spaces prepended after the level tag, default `0`), `logFile?: string` (path to append all output to), `verbose?: boolean` (show detail lines and live agent output on terminal).

Methods:
- `info(message)`, `warn(message)`, `error(message)` — leveled log output (with indentation padding)
- `phaseBegin(text)` — start a pending phase line (with spinner in TTY mode)
- `phaseEnd(marker, durationMs)` — complete the pending line with `[DONE]`/`[SKIP]`/`[FAIL]` and duration
- `phaseImmediate(text, marker, durationMs?)` — emit a phase line that is immediately complete (used for `[SKIP]` lines and the final summary)
- `detail(message)` — always goes to the log file; appears on terminal only under `--verbose`
- `logFileSize()` — returns the current size of the log file in bytes
- `tailLog(fromByte, maxLines?)` — reads the last N lines from the log file starting at a byte offset
- `child(extraIndent = 2)` — returns a new `Logger` wrapping the same `OutputSink` with additional indentation
- `getSink()` — returns the underlying `OutputSink`
- `dispose()` — stops the spinner timer

`silentLogger()` returns a `Logger` backed by a no-op writable stream, used when no logger is provided to the runner.

### Output (`src/output.ts`)

Low-level terminal output engine. `OutputSink` manages the pending-line state machine, TTY spinner animation, column-aligned marker rendering, and log-file append. `Logger` wraps `OutputSink` and delegates all output through it.

**Exports**: `OutputSink` class, `OutputSinkOptions` interface, `Marker` type, `formatDuration()`, `truncateLabel()`

`Marker` is a string union: `"DONE" | "SKIP" | "FAIL"`. Rendered as `[DONE]`, `[SKIP]`, `[FAIL]` with ANSI color in TTY mode (green, dim, red via `picocolors`), plain text in CI mode.

`OutputSinkOptions` fields: `ci?: boolean`, `stream?: NodeJS.WritableStream` (default `process.stderr`), `logFile?: string`, `verbose?: boolean`.

`OutputSink` behavior:
- **Phase lines**: `phaseBegin(text)` writes the line and starts a braille spinner in TTY mode (120ms frame interval). `phaseEnd(marker, durationMs)` clears the spinner and renders `[MARKER] duration` column-aligned at a computed marker column (default column 72, minimum 40, adapts to terminal width). `phaseImmediate(text, marker, durationMs?)` emits a complete line without pending state.
- **Detail lines**: `detail(message)` always appends to the log file; appears on terminal only when `verbose` is true.
- **Level lines**: `info()`, `warn()`, `error()` emit `[LEVEL]` tagged lines to both the stream and log file.
- **Log introspection**: `logFileSize()` returns the current log file size. `tailLog(fromByte, maxLines)` reads the last N lines from the log file starting at a byte offset.
- **Lifecycle**: `dispose()` stops the spinner timer.

`formatDuration(ms)` formats milliseconds as human-readable durations: `<1s` → `"Nms"`, `<60s` → `"N.Ns"`, `≥60s` → `"NmNNs"`.

`truncateLabel(prefix, label, suffix, maxWidth)` truncates the label portion of a phase line to fit within a maximum width while preserving the prefix (`Phase N/M: `) and suffix (`(iteration i/k)`), using an ellipsis character when truncation is needed.

### Flow Definitions (`flows/`)

YAML files that define the step sequence for each subcommand. The engine loads them by name.

| Flow | Subcommand | Steps |
|------|------------|-------|
| `init.flow.yaml` | `init` | Architecture → plan → phase-0 slice → install-rules → foreach phase (slice + verify/fix loop) → generate baseline. All script/prompt steps receive `docs_dir` from scope. |
| `update.flow.yaml` | `update` | Detect changes → if changes exist: plan → foreach phase (slice + verify/fix loop) → regenerate baseline. All script/prompt steps receive `docs_dir` from scope. |
| `quick-update.flow.yaml` | `quick-update` | Detect changes → if changes exist: agent quick-update → read status → if UPDATED: archive-quick-update → generate baseline. Metadata paths use `${docs_dir}`. |
| `verify-quick-updates.flow.yaml` | `verify-quick-updates` | Collect quick-updates → if any: plan → foreach phase (slice + verify/fix loop) → remove processed artifacts. Metadata paths use `${docs_dir}`. |

### Prompt Templates (`prompts/`)

Markdown files with `{var}` placeholders, rendered by the templates module before being passed to an agent.

| Template | Purpose |
|----------|---------|
| `document-architecture.md` | Generate architecture documentation |
| `plan-init.md` | Create initial documentation plan |
| `plan-update.md` | Create incremental update plan from change report |
| `plan-verify-quick-updates.md` | Create verification plan from accumulated quick-update artifacts |
| `quick-update.md` | Fast single-session documentation update |
| `slice-doc.md` | Document a single phase |
| `verify-domain-documentation.md` | Review phase output and produce PASS/FAIL status |
| `fix-documentation.md` | Fix issues identified by verification |

## Module Dependency Graph

```mermaid
flowchart BT
    paths[paths]
    output[output]
    logger[logger]
    templates[templates]
    runctx[run-context]
    agtypes[agent/types]
    cursor[agent/cursor-agent]
    copilot[agent/copilot-agent]
    claude[agent/claude-agent]
    fake[agent/fake-agent]
    backend[cli/backend]
    confirm[cli/confirm]
    config[cli/config]
    etypes[engine/types]
    expr[engine/expression]
    loader[engine/loader]
    prims[engine/primitives]
    phases[engine/phases]
    runner[engine/runner]
    scripts[scripts/registry]
    parsep[scripts/parse-plan]
    detect[scripts/detect-changes]
    genbl[scripts/generate-baseline]
    fmani[scripts/file-manifest]
    archive[scripts/archive-quick-update]
    collect[scripts/collect-quick-updates]
    removqu[scripts/remove-quick-updates]
    instrules[scripts/install-rules]
    cli[cli]

    cursor --> agtypes
    copilot --> agtypes
    claude --> agtypes
    fake --> agtypes
    backend --> agtypes
    backend --> cursor
    backend --> copilot
    backend --> claude

    logger --> output

    loader --> etypes
    loader --> paths
    expr --> etypes
    phases --> expr
    phases --> etypes
    prims --> expr
    prims --> etypes
    runner --> prims
    runner --> expr
    runner --> etypes
    runner --> templates
    runner --> paths
    runner --> logger
    runner --> output
    runner --> phases
    runner --> scripts

    scripts --> parsep
    scripts --> detect
    scripts --> genbl
    scripts --> archive
    scripts --> collect
    scripts --> removqu
    scripts --> instrules
    detect --> fmani
    genbl --> fmani
    instrules --> paths
    instrules --> templates

    cli --> backend
    cli --> confirm
    cli --> config
    cli --> loader
    cli --> runner
    cli --> runctx
    cli --> logger
    cli --> paths
    cli --> instrules

    style cli fill:#4A90D9,color:#fff
    style runner fill:#7B68EE,color:#fff
    style agtypes fill:#3CB371,color:#fff
    style scripts fill:#DAA520,color:#fff
    style output fill:#E06C75,color:#fff
```
