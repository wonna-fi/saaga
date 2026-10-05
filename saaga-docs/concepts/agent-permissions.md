---
title: Agent Permissions
type: concept
sources:
  - src/agent/permissions.ts
  - src/agent/claude-agent.ts
  - src/agent/copilot-agent.ts
  - src/agent/cursor-agent.ts
  - src/agent/kiro-agent.ts
  - src/agent/codex-agent.ts
  - src/agent/codex-hook.ts
  - src/cli.ts
  - src/doctor/full-probes.ts
terms:
  - permission profile
  - AgentPermissions
  - restricted shell
  - ALLOWED_SHELL_COMMANDS
  - CODEX_SHELL_COMMANDS
last_verified: 2026-10-05
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
- `CODEX_SHELL_COMMANDS` (constant) - codex's wider variant of it

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
| `agent/codex-agent` | `probeCodexExecutable()` | Ask codex which executable its restricted sandbox must be able to read; no model call |
| `agent/codex-agent` | `CODEX_SHELL_COMMANDS` | Codex's shell policy, handed to its hook |
| `agent/codex-hook` | `CODEX_HOOK_SCRIPT` | The `PreToolUse` hook source, run by Node with the policy as argv |
| `agent/kiro-agent` | `buildKiroPermissionRules()`, `KiroPermissionRule` | Translate a profile into kiro v3 capability rules |
| `agent/kiro-agent` | `realPathForms()`, `sweepStaleProfiles()`, `KIRO_PROFILE_MARKER` | Real-path variants of a path; the leftover-profile sweep and the marker it trusts |

### The restricted shell

`shell: "restricted"` permits two groups: navigation and inspection utilities, and read-only
git subcommands. Read the membership from `ALLOWED_SHELL_COMMANDS`; what governs it is that a
permitted command must neither mutate the repository nor be a general escape hatch. Git rules
anchor on the *subcommand*, which defeats `git -c core.pager='sh -c …' log`: that command
begins `git -c`, not `git log`.

Codex enforces a wider set, `CODEX_SHELL_COMMANDS` (adds `cat` and `rg`), through its
`PreToolUse` hook `CODEX_HOOK_SCRIPT`, run as `node -e <script> <policy JSON>` — in argv so an
agent cannot rewrite it via the writable run directory. Only words, quotes, `|` and `&&` pass;
expansions, redirections, `;`, globs and newlines are refused, as are program-running git options
(`--ext-diff`, `--textconv`, `--output`, … even abbreviated) and `rg --pre`/`--hostname-bin`. An
allowed command is re-emitted fully quoted, git gaining `--no-pager` and `-c` overrides blanking
its pager, external diff and signature programs. Tools other than the shell, `apply_patch` and
`update_plan` are refused with `Saaga policy: <reason>`, as [agent events](./agent-events.md) parses.

### Per-backend translation

| Backend | Allowed by | Denied by | Shell |
|---|---|---|---|
| `claude` | `Edit(//<writeRoot>/**)` in a `--settings` JSON, plus `additionalDirectories` for roots outside `cwd`; `--permission-mode dontAsk` makes that JSON authoritative instead of prompting | A named tool deny list, `Edit(//<denyPath>)`, patterns closing claude's built-in Bash set, and `--strict-mcp-config`, which leaves the session with no MCP servers so an ambient user or project config cannot widen the tool surface | Scoped `Bash(cmd:*)` / `Bash(git sub:*)` allows, or a bare `Bash` deny under `shell: "none"` |
| `copilot` | `--available-tools` names the visible tools; `--allow-tool write` grants file changes inside the workspace | `--disallow-temp-dir`, and the workspace boundary itself; roots outside `cwd` are re-granted with `--add-dir` | `shell(cmd:*)` / `shell(git:sub*)` entries on `--allow-tool`, and `bash` withheld from the tool list otherwise |
| `cursor` | Nothing: with `--trust`, reads and writes are permitted by default | A generated `<runDir>/.cursor-cli/cli-config.json`, reached via `CURSOR_CONFIG_DIR`, denying every path `enumerateExcludedPaths()` returns plus each `denyPath` | `Shell(cmd:*)` / `Shell(git:sub*)` allow entries — shell is the one default-deny surface |
| `kiro` | `fs_read`/`fs_write` rules matching the read/write roots, in a temporary named agent under `~/.kiro/agents/` (kiro's v3 engine ignores `KIRO_HOME`) | Each allow's counterpart deny (`match: ["**"], exclude: <roots>`), plus an `fs_write` deny of the `denyPaths` (reads stay allowed) and one per name in `DENIED_CAPABILITIES` (`mcp`, `power`, `subagent`, `skill`, `web_fetch`, `web_search`) | A `shell` allow for the same commands paired with a `match: ["*"]` deny excluding them, or a bare `shell` deny under `shell: "none"` |
| `codex` | A named `saaga` filesystem permission set passed via `--config`: `:minimal` system reads, `write` for each surviving write root, `read` for read roots; `--ignore-user-config --ignore-rules --strict-config`, and the project pinned `untrusted` so its own config and hooks cannot widen the run | Protected paths (`denyPaths`, plus `.git`, `.codex`, `.agents` under each root) are re-granted `read` only, which removes the parent's write grant; roots inside a protected path get no write grant. Network, web search, apps, plugins and multi-agent are off. Codex's own native binary, which it re-executes inside bubblewrap for each shell command, gets a `read` grant for that one file (never its directory), found by `probeCodexExecutable()` — a `codex sandbox … true` run whose bwrap exec failure names the binary, `undefined` on any failure — unless a root already covers it | The shell tool behind the `PreToolUse` hook above, with no login shell and an environment of only a fixed `PATH`; the tool is off under `shell: "none"` |

Two structural differences drive most of that table. Under cursor's `--trust` a deny overrides
any allow, so the permitted set cannot be stated positively and has to be carved out instead:
`enumerateExcludedPaths()` walks the ancestor chain of each kept root and denies the siblings
at every level. Copilot cannot scope writes *within* the workspace at all, so there the
workspace boundary is the whole file guarantee and `denyPaths` go unenforced — which is why a
denial is classified against the profile rather than taken at face value; see
[agent events](./agent-events.md). Kiro is deny-wins like cursor, but its rules are scoped by
`match`/`exclude` glob lists rather than by ancestor path, and it always merges in the user's
own `~/.kiro/settings/permissions.yaml` — so an allow rule alone could be widened by that file,
which is why every kiro allow is paired with an explicit deny of everything else in the same
capability rather than relying on omission.

Kiro's profile lives in the user's home. Each restricted call writes a named agent
`~/.kiro/agents/saaga-<hex>.json`, created exclusively (`wx`) so no file is overwritten, and
deletes it when the call ends — also from a synchronous `exit` listener, since a signal's
`process.exit()` skips the `finally`. Before writing, it sweeps `saaga-*.json` agents over 24
hours old whose description is `KIRO_PROFILE_MARKER`, reclaiming a killed run's leftover but
never a user's own agent. A copy stays at `<runDir>/.kiro-cli/agent.json` as the run's record,
and every path appears in its given and real-path forms (`realPathForms()`): kiro matches
`/private/tmp`, not `/tmp`.

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
- `tests/agent/{claude,copilot,kiro,codex}-agent.test.ts` - the argv, settings and kiro rules a profile produces
- `tests/agent/codex-hook.test.ts` - commands the codex hook allows, rewrites and refuses

## Related Concepts

- [Agent Interface](./agent-interface.md)
- [Agent Events](./agent-events.md)
- [Baseline and Change Detection](./baseline-and-change-detection.md)
- [Feature: CLI Entry Point](../features/cli-entry-point.md)
