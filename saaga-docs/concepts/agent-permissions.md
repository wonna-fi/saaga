# Agent Permissions and Restriction

## Business Definition

Agent permissions define a declarative profile that constrains what an agent backend can read, write, and execute during a Saaga run. By default, agents run under a restricted profile that limits filesystem access to the workspace and documentation directories, denies modification of rule files and baselines, and restricts shell usage to a fixed set of safe utility commands and read-only git subcommands. This prevents documentation runs from accidentally modifying source code, configuration, or files outside the project.

## Configuration

| Source | Description |
|--------|-------------|
| `BuildProfileInput` parameter to `buildProfile()` | Provides `appPath`, `docsDir`, `runDir`, and optional `allowDirs` |
| CLI flag `--allow-dir` | Appends extra directories to both `readRoots` and `writeRoots` |
| CLI flag `--dangerously-allow-all` | Disables the permission system entirely (no profile is built) |

**How to access:**
- `buildProfile(input)` — constructs the default restricted `AgentPermissions` profile
- `enumerateExcludedPaths(keepPaths)` — lists all sibling filesystem entries outside the keep paths (used by Cursor backend)
- `ALLOWED_SHELL_COMMANDS` (constant) — commands permitted under the `"restricted"` shell policy: `utilities` (`cd`, `ls`, `pwd`, `grep`, `head`, `tail`, `wc`, `dirname`, `basename`) and `git` read-only subcommands

## Data Storage

| Object/Model/Type | Field/Property | Purpose |
|--------|-------|---------|
| `AgentPermissions` | `readRoots` | Directories the agent may read (absolute paths) |
| `AgentPermissions` | `writeRoots` | Directories the agent may write (absolute paths) |
| `AgentPermissions` | `denyPaths` | Paths the agent must never access, even within a root (supports glob `**` suffix) |
| `AgentPermissions` | `shell` | Shell policy: `"none"` or `"restricted"` |
| `BuildProfileInput` | `appPath` | The application root directory |
| `BuildProfileInput` | `docsDir` | Relative path to the documentation directory (becomes a write root) |
| `BuildProfileInput` | `runDir` | Absolute path to the run directory (becomes a write root) |
| `BuildProfileInput` | `allowDirs` | Optional extra directories to grant full access to |

## Key Services/Functions (PUBLIC/EXPORTED only)

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `src/agent/permissions.ts` | `buildProfile()` | Constructs the default restricted permission profile from app path, docs dir, run dir, and optional extra dirs |
| `src/agent/permissions.ts` | `enumerateExcludedPaths()` | Walks ancestor chains of keep paths and lists all sibling entries that fall outside, used for backends that only support deny rules |
| `src/agent/permissions.ts` | `AgentPermissions` (interface) | The shape of a permission profile: read/write roots, deny paths, shell policy |
| `src/agent/permissions.ts` | `BuildProfileInput` (interface) | Input shape for `buildProfile()` |
| `src/agent/permissions.ts` | `ALLOWED_SHELL_COMMANDS` (constant) | Commands allowed under the restricted shell policy: `utilities` (`cd`, `ls`, `pwd`, `grep`, `head`, `tail`, `wc`, `dirname`, `basename`) and `git` read-only subcommands (`log`, `show`, `diff`, `blame`, `status`, `ls-files`, `cat-file`, `rev-parse`) |

## Default Profile Grants

When `buildProfile()` is called with standard inputs, the resulting profile grants:

- **Read**: entire app tree (the run dir is inside the app tree since it lives at `<appPath>/.saaga-runs/`)
- **Write**: `<appPath>/<docsDir>/**` and the run directory
- **Deny**: `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/**`, `.github/instructions/**`, `.saagarules`, `<docsDir>/BASELINE`
- **Shell**: restricted (utilities + read-only git subcommands)

## Backend Translation

Each backend translates the `AgentPermissions` profile into its native permission mechanism:

| Backend | Unrestricted Mode | Restricted Mode |
|---------|-------------------|-----------------|
| Cursor | `--force` | `--trust` + `cli-config.json` deny rules (via `CURSOR_CONFIG_DIR` env) |
| Copilot | `--allow-all-tools` | `--available-tools` allowlist + `--allow-tool` + `--disallow-temp-dir` |
| Claude | `--dangerously-skip-permissions` | `--permission-mode dontAsk` + `--settings` JSON (allow/deny/additionalDirectories) |

### Cursor Translation Details

Cursor's `--trust` mode enforces deny rules only (reads and writes are permitted by default). The profile is expressed by:
1. Enumerating all paths **outside** `readRoots` as `Read`/`Write`/`Edit` deny rules
2. Enumerating all paths **outside** `writeRoots` as `Write`/`Edit` deny rules
3. Adding explicit deny paths as `Write`/`Edit` deny rules
4. Allowing shell via `Shell(<util>:*)` patterns for each utility in `ALLOWED_SHELL_COMMANDS.utilities` and `Shell(git:<subcommand>*)` patterns for each entry in `ALLOWED_SHELL_COMMANDS.git`

The configuration is written to `<runDir>/.cursor-cli/cli-config.json` and pointed to via the `CURSOR_CONFIG_DIR` environment variable.

### Copilot Translation Details

Copilot has no middle ground between restricted and unrestricted. Under restriction:
- File tools are allowed via `--available-tools`: `view`, `create`, `edit`, `glob`, `grep`, plus `bash` when `shell` is `"restricted"`
- When `shell` is `"restricted"`, `--allow-tool` grants a `shell(<command>:*)` / `shell(git:<subcommand>*)` pattern for each `ALLOWED_SHELL_COMMANDS` entry, alongside the `write` tool grant
- `--disallow-temp-dir` closes the temp directory hole
- Extra roots outside `cwd` are added via `--add-dir`

### Claude Translation Details

Claude uses `--permission-mode dontAsk` with a `--settings` JSON payload:
- Write roots are expressed as `Edit(//<path>/**)` allow rules
- Denied paths are expressed as `Edit(//<path>)` deny rules
- Unwanted tools (`Task`, `WebFetch`, `WebSearch`, subagent/cron tools, etc.) are denied by name
- Additional read directories are listed in `additionalDirectories`
- When `shell` is `"restricted"`, each `ALLOWED_SHELL_COMMANDS` entry becomes a scoped `Bash(<command>:*)` / `Bash(git <subcommand>:*)` allow rule. Claude still auto-runs a built-in set of read-only Bash commands under `dontAsk` regardless of `permissions.allow`, so the adapter also denies the built-ins that fall outside the restricted policy (`Bash(cat *)`, `Bash(echo *)`, `Bash(find *)`, `Bash(python3 *)`, etc., see `CLAUDE_BUILTIN_BASH_DENY` in `src/agent/claude-agent.ts`)
- When `shell` is `"none"`, a bare `Bash` deny is emitted instead — that deny would otherwise override every scoped allow, which is why it is only used for the no-shell case

## Internal Implementation

> Functions below are internal and should not be called directly. They are documented for understanding the internal logic.
>
> - `src/agent/cursor-agent.ts`.`writeCursorConfig()` — generates the `cli-config.json` and returns the env override
> - `src/agent/cursor-agent.ts`.`pathRules()` — emits deny rule strings in both bare and glob form for a given path
> - `src/agent/copilot-agent.ts`.`buildRestrictedCopilotArgs()` — builds the restricted CLI argument array for Copilot
> - `src/agent/claude-agent.ts`.`buildClaudeSettings()` — constructs the settings JSON for Claude's permission layer
> - `src/agent/claude-agent.ts`.`restrictedBashAllowRules()` — maps `ALLOWED_SHELL_COMMANDS` into `Bash(...)` allow rule strings
> - `src/agent/claude-agent.ts`.`CLAUDE_BUILTIN_BASH_DENY` (constant) — Bash command patterns denied by name to close Claude's built-in read-only Bash gap under `dontAsk`

## Reference Implementations

- `src/agent/permissions.ts` — canonical definition of the permission profile and profile builder
- `src/agent/cursor-agent.ts` — demonstrates the most complex translation: deny-rule enumeration via `enumerateExcludedPaths()` and `cli-config.json` generation
- `src/agent/copilot-agent.ts` — demonstrates the tool-allowlist approach with `--available-tools`
- `src/agent/claude-agent.ts` — demonstrates the settings JSON approach with `--permission-mode dontAsk`

## Related Concepts

- [Agent Interface](./agent-interface.md) — the `AgentRunOpts.permissions` field that carries the profile to backends
- [Agent Events and Denial Parsing](./agent-events.md) — structured reporting and auditing of permission denials
- [Saaga Rules](./saaga-rules.md) — `.saagarules` is on the default deny list
