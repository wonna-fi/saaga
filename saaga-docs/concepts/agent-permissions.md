---
title: Agent Permissions
type: concept
sources:
  - src/agent/permissions.ts
  - src/agent/claude-agent.ts
  - src/agent/copilot-agent.ts
  - src/agent/cursor-agent.ts
  - src/cli.ts
  - src/doctor/full-probes.ts
terms:
  - permission profile
  - AgentPermissions
  - restricted shell
  - ALLOWED_SHELL_COMMANDS
last_verified: 2026-09-01
---

# Agent Permissions

## Business Definition

A **permission profile** is what a run will let the agent touch: which trees it may read,
which it may write, which paths are withheld outright, and whether it gets a shell. Saaga
states that once in backend-neutral terms and each backend translates it into its own CLI's
syntax, so the same guarantee holds whichever agent is driving.

The default profile is deliberately narrow: the agent reads the whole repository, writes only
the documentation directory and the run directory, and runs only read-only shell commands.
Everything a documentation run must not rewrite — the rule files it is governed by, the
machine-managed corpus files — is denied by path even though it sits inside a granted tree.

## Configuration

| Source | Precedence | Description |
|--------|------------|-------------|
| `--dangerously-allow-all` | 1 (highest) | No profile is built at all; the backend uses its own unrestricted flags |
| `--allow-dir <path>` (repeatable) | 2 | Each path is appended to *both* `readRoots` and `writeRoots` |
| `docsDir` in [`.saaga/config.yaml`](./project-configuration.md) | 3 | Decides which directory becomes the writable corpus root |
| `buildProfile()` defaults | 4 | Everything else: the app tree, the run directory, the deny list, `shell: "restricted"` |

The [CLI](../features/cli-entry-point.md) builds the profile once per run, records it in the
run directory, and passes it to every agent step; there is no per-step profile.

**How to access:**
- `buildProfile({ appPath, docsDir, runDir, allowDirs })` - the profile for a run
- `enumerateExcludedPaths(keepPaths)` - the paths to deny so only `keepPaths` stay reachable
- `ALLOWED_SHELL_COMMANDS` (constant) - the restricted shell policy, grouped `utilities` and `git`

## Data Storage

| Type | Field/Property | Purpose |
|--------|-------|---------|
| `AgentPermissions` | `readRoots` | Trees the agent may read: the app tree, plus any `--allow-dir` |
| `AgentPermissions` | `writeRoots` | Trees it may write: `<app>/<docsDir>`, the run directory, plus any `--allow-dir` |
| `AgentPermissions` | `denyPaths` | Paths withheld even inside a granted root; globs end in `**` |
| `AgentPermissions` | `shell` | `"none"` or `"restricted"` |

The default `denyPaths` are `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/**`,
`.github/instructions/**` and `.saagarules` — the rule files an agent must obey rather than
edit, see [install rules](../features/install-rules.md) — plus `BASELINE`, `FORMAT`,
`README.md` and `GLOSSARY.md` under the docs directory. The last two are denied because
[navigation generation](../features/navigation-generation.md) rewrites them from the INDEX
files every run: a hand edit vanishes without trace, and an agent "fixing" them against a
template would churn the diff every time.

## Key Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `agent/permissions` | `AgentPermissions`, `BuildProfileInput` | The profile shape and what it is derived from |
| `agent/permissions` | `buildProfile()` | Build the default restricted profile for a run |
| `agent/permissions` | `enumerateExcludedPaths()` | Turn "keep these" into "deny everything else" |
| `agent/permissions` | `ALLOWED_SHELL_COMMANDS` | The restricted shell policy |
| `agent/claude-agent` | `CLAUDE_RESTRICTED_TOOLS` | The tool surface a restricted claude run should be left with |

### The restricted shell

`shell: "restricted"` permits two groups: navigation and inspection utilities, and read-only
git subcommands. Read the membership from `ALLOWED_SHELL_COMMANDS`; what governs it is that a
permitted command must neither mutate the repository nor be a general escape hatch. Git rules
anchor on the *subcommand*, which defeats `git -c core.pager='sh -c …' log`: that command
begins `git -c`, not `git log`.

### Per-backend translation

| Backend | Allowed by | Denied by | Shell |
|---|---|---|---|
| `claude` | `Edit(//<writeRoot>/**)` in a `--settings` JSON, plus `additionalDirectories` for roots outside `cwd`; `--permission-mode dontAsk` makes that JSON authoritative instead of prompting | A named tool deny list, `Edit(//<denyPath>)`, patterns closing claude's built-in Bash set, and `--strict-mcp-config`, which leaves the session with no MCP servers so an ambient user or project config cannot widen the tool surface | Scoped `Bash(cmd:*)` / `Bash(git sub:*)` allows, or a bare `Bash` deny under `shell: "none"` |
| `copilot` | `--available-tools` names the visible tools; `--allow-tool write` grants file changes inside the workspace | `--disallow-temp-dir`, and the workspace boundary itself; roots outside `cwd` are re-granted with `--add-dir` | `shell(cmd:*)` / `shell(git:sub*)` entries on `--allow-tool`, and `bash` withheld from the tool list otherwise |
| `cursor` | Nothing: with `--trust`, reads and writes are permitted by default | A generated `<runDir>/.cursor-cli/cli-config.json`, reached via `CURSOR_CONFIG_DIR`, denying every path `enumerateExcludedPaths()` returns plus each `denyPath` | `Shell(cmd:*)` / `Shell(git:sub*)` allow entries — shell is the one default-deny surface |

Two structural differences drive that table. Under cursor's `--trust` a deny overrides any
allow, so the permitted set cannot be stated positively and has to be carved out instead:
`enumerateExcludedPaths()` walks the ancestor chain of each kept root and denies the siblings
at every level. Copilot cannot scope writes *within* the workspace at all, so there the
workspace boundary is the whole file guarantee and `denyPaths` go unenforced — which is why a
denial is classified against the profile rather than taken at face value; see
[agent events](./agent-events.md).

## Internal Implementation

> - `agent/claude-agent.buildClaudeSettings()` - encodes four verified gotchas: file checks
>   honour `Edit(path)` and ignore `Write(path)`; an absolute path needs a doubled slash
>   (`//abs/path/**`); `additionalDirectories` grants reach but not edit rights, so a root
>   outside `cwd` needs both; and claude runs a built-in read-only Bash set without prompting
>   in every mode, so those commands are denied by name to hold the restricted policy.
> - `agent/claude-agent.DENIED_TOOLS` - with no exclusive tool allowlist available, unwanted
>   tools are denied by name, so a tool added in a later release arrives *enabled*. The
>   `claude/tool-surface` probe in [doctor](../features/doctor.md) catches that drift.

## Reference Implementations

- `src/agent/permissions.ts` - the profile, the shell policy, and the exclusion walk
- `src/agent/cursor-agent.ts` - `writeCursorConfig()`, the deny-only translation in full
- `tests/agent/permissions.test.ts` - what `buildProfile()` grants and withholds
- `tests/agent/{claude,copilot}-agent.test.ts` - the argv and settings a profile produces

## Related Concepts

- [Agent Interface](./agent-interface.md)
- [Agent Events](./agent-events.md)
- [Baseline and Change Detection](./baseline-and-change-detection.md)
- [Feature: CLI Entry Point](../features/cli-entry-point.md)
