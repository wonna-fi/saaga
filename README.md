# Saaga

Coding agents are amnesiac. Every session starts from zero — the agent
re-discovers your architecture, re-reads your conventions, and re-derives
how things work, with varying degrees of success. The larger the
codebase, the worse this gets: agents waste tokens on exploration,
hallucinate patterns that don't exist, and produce inconsistent work
across sessions.

Saaga fixes this by driving a coding agent to write concise, thorough
domain documentation for your codebase — then installing always-on rules
that tell agents to read those docs *before* they touch source code.
The result is an agent that already understands your system before it
writes a single line.

## How it works

Saaga orchestrates a headless coding agent (Cursor, GitHub Copilot, or
Claude Code) through a multi-phase workflow:

1. **Analyze** — the agent studies the codebase and produces architecture
   documentation.
2. **Plan** — it identifies the domain areas that need documenting and
   creates a phased plan.
3. **Document** — each phase is written as structured domain docs
   (concepts, features, patterns).
4. **Verify** — a self-critic loop reviews each phase and fixes issues
   before moving on.
5. **Baseline** — a content snapshot is saved so future runs only
   re-document what actually changed.

## What you get

After `saaga init`, your project contains:

- **`saaga-docs/`** — structured domain documentation organized into
  three categories:
  - **Concepts** — what something is and where it lives (architecture,
    data models, configuration).
  - **Features** — end-to-end feature specifications (workflows, user
    flows, edge cases).
  - **Patterns** — how to do common operations (adding endpoints,
    extending workflows, testing).

- **Always-on agent rules** — Saaga installs guidance into the rule
  files your agent already reads, telling it to consult `saaga-docs/`
  before exploring source. Supported targets:

  | Target | File |
  | ------ | ---- |
  | `agentsmd` | `AGENTS.md` (managed block) |
  | `cursor` | `.cursor/rules/domain-docs.mdc` |
  | `claude` | `CLAUDE.md` (managed block) |
  | `copilot` | `.github/instructions/domain-docs.instructions.md` |

- **`saaga-docs/BASELINE`** — a content manifest that lets `saaga update`
  detect what changed and re-document only the affected areas.

## Prerequisites

Saaga runs on **Linux** and **macOS**. Windows is not tested natively;
Windows users should run Saaga under WSL2 or inside a container (see
[Running in containers](#running-in-containers-recommended)).

You need at least one agent backend CLI installed and on your `$PATH`.
Each backend must be authenticated independently (e.g. by logging in to
the CLI or setting credentials in the environment). Saaga does not manage
API keys itself.

| Backend  | CLI              | Default high                    | Default medium                      | Default low                         |
| -------- | ---------------- | ------------------------------- | ----------------------------------- | ----------------------------------- |
| cursor   | `cursor-agent`   | `claude-4.6-opus-high-thinking` | `cursor-grok-4.5-high`              | `composer-2.5`                      |
| copilot  | `copilot`        | `claude-sonnet-4.6`             | `claude-sonnet-4.6`                 | `claude-haiku-4.5`                  |
| claude   | `claude`         | `opus`                          | `sonnet`                            | `haiku`                            |

> **Restricted by default** — Saaga restricts each agent backend to the
> narrow permissions it actually needs. On every backend the agent cannot
> run arbitrary shell commands and cannot reach outside the app tree
> (the run directory lives inside the workspace at `.saaga-runs/`).
> Running in a container is still recommended for defense in depth — see
> [Running in containers](#running-in-containers) and
> [Permissions](#permissions) below.

## Quick start

Install from npm:

```bash
npm install -g @wonna/saaga
```

Or run without installing:

```bash
npx @wonna/saaga <command>
```

Generate initial documentation (run from inside your project):

```bash
saaga init --backend cursor
```

> **Heads up** — `init` is the heavy one. It drives the agent through
> several phases (analyze, plan, document, verify/fix), so it can run for
> many hours and consume a large number of tokens on a sizeable
> codebase. This is a one-time cost; afterwards you maintain the docs
> with the much cheaper `update` and `quick-update`. See
> [Runtime and cost](#runtime-and-cost) before your first run.

After code changes, update the docs incrementally:

```bash
saaga update
```

## Commands

All directory subcommands accept an optional `[dir]` argument that
defaults to the current working directory.

```text
saaga init [dir]                Full initial documentation
                                (architecture + plan + phases +
                                verify/fix + baseline).

saaga update [dir]              Detect changes since BASELINE,
                                regenerate affected slices, refresh
                                baseline.

saaga quick-update [dir]        Fast single-session doc update using
                                a cheaper model. Produces a metadata
                                artifact for later verification.

saaga verify-quick-updates [dir]
                                Consolidate and verify all unverified
                                quick-update artifacts.

saaga install-rules [dir]       Install always-on documentation rules
                                into agent rule files. No agent backend
                                required.

saaga doctor                    Check backend CLI availability and
                                run capability probes. See
                                "Diagnosing backend issues" below.
```

### Global flags

| Flag | Short | Description |
| ---- | ----- | ----------- |
| `--backend <name>` | `-b` | Agent backend: `cursor`, `copilot`, or `claude` |
| `--model-low <name>` | | Override the low-tier model for this invocation |
| `--model-medium <name>` | | Override the medium-tier model for this invocation |
| `--model-high <name>` | | Override the high-tier model for this invocation |
| `--ci` | | Plain (non-color) log output, suitable for CI pipelines |
| `--yes` | `-y` | Skip the cost confirmation prompt (see [Runtime and cost](#runtime-and-cost)) |
| `--allow-dir <path>` | | Grant additional read/write access to a directory (repeatable; see [Permissions](#permissions)) |
| `--unstable-feature <name>` | | Enable an unstable feature (repeatable; see [Unstable features](#unstable-features)) |
| `--dangerously-allow-all` | | Run without permission restrictions, reproducing legacy unrestricted behavior |
| `--audit-permissions` | | Scan agent output for permission denials and log a summary to `<run_dir>/permission-audit.log` |
| `--version` | `-v` | Print the version and exit |

### Subcommand-specific flags

| Flag | Subcommands | Description |
| ---- | ----------- | ----------- |
| `--rule-targets <targets>` | `init`, `install-rules` | Comma-separated rule targets: `agentsmd`, `cursor`, `claude`, `copilot`, `none` |

### Output locations

- **Run artifacts** (plans, status files, change reports) are written
  under `<project>/.saaga-runs/<run-id>/`. This directory is
  automatically added to `.gitignore` by `saaga init`.
- **Generated docs** land in `<project>/saaga-docs/`.

## Runtime and cost

Saaga works by driving a real coding-agent CLI, so its runtime and token
usage track whatever your backend charges — they scale with the size of
your codebase and the amount of documentation being generated. Treat the
guidance below as relative expectations, not fixed numbers.

| Command | What it runs | Expect |
| ------- | ------------ | ------ |
| `init` | Multiple agent sessions across all phases over the whole codebase | **Longest and most token-intensive.** Many hours; a large, one-time token spend. |
| `update` | Re-documents only the slices that changed since `BASELINE` | Proportional to how much changed — usually a fraction of `init`, ~20-30 minutes |
| `quick-update` | A single session on a cheaper model | Fast and cheap; the lightest agent-backed command. ~3-10 minutes. |
| `verify-quick-updates` | One consolidation/verification session | Short; scales with the number of pending quick-update artifacts. Comparable to one `update`. |
| `install-rules` | No agent backend at all | Effectively instant; no tokens used. |

> **Token usage disclaimer** — `init` in particular can consume a
> substantial number of tokens, since it reads across your entire
> codebase and runs several agent phases including a verify/fix loop.
> Costs depend on your chosen backend and model. If you want to keep the
> initial spend down, point `--model-high` at a cheaper model or scope
> what gets documented with [`.saagaignore`](#excluding-files-saagaignore).

### Cost confirmation prompt

Every agent-backed command (`init`, `update`, `quick-update`,
`verify-quick-updates`) prints a cost notice before it starts, naming the
backend CLI it is about to run and reminding you that the resulting agent
usage is billed to your own account with that provider. On an interactive
terminal it then asks for confirmation:

```text
Cost notice: 'saaga init' will run the 'cursor-agent' CLI (backend cursor, model
claude-4.6-opus-high-thinking) as an autonomous coding agent over /path/to/app.
Agent sessions consume tokens that are billed to your own cursor-agent account,
at whatever rate your plan with that provider applies. Saaga does not include or
cover any of that usage.
init is the heaviest command: it drives several agent phases across the whole
codebase, so expect a long run and a large one-time token spend.
Skip this prompt with --yes, or set 'autoApprove: true' in .saaga/config.yaml.
Continue? [y/N]
```

Declining exits with code 1 without starting a run. Pass `--yes` (or set
`autoApprove: true` in `.saaga/config.yaml`) to approve up front. When
stdin is not a terminal — pipelines, `--ci`, scripted runs — the notice
is printed and the command continues without waiting for input.

`install-rules` never prompts: it uses no agent and costs nothing.

## Configuration

Create `.saaga/config.yaml` in your project directory to set persistent
defaults. All keys are optional; CLI flags always take precedence.

```yaml
# .saaga/config.yaml
defaultBackend: cursor     # cursor | copilot | claude
backends:                  # per-backend model overrides (all optional)
  cursor:
    modelLow: claude-4.6-sonnet-medium-thinking
    modelMedium: claude-4.6-sonnet-medium-thinking
    modelHigh: claude-4.6-opus-high-thinking
  claude:
    modelHigh: opus
ruleTargets: [agentsmd]    # agentsmd | cursor | claude | copilot | none
docsDir: saaga-docs        # name of the generated docs folder (default: saaga-docs)
autoApprove: false         # true skips the cost confirmation prompt (same as --yes)
unstableFeatures: []      # list of unstable features to enable (see below)
```

Each backend supports three model tiers: `modelLow` (doctor probes),
`modelMedium` (quick-update), and `modelHigh` (init, update,
verify-quick-updates). Any absent tier falls back to a built-in default.

Resolution order: **CLI flag (`--model-low` / `--model-medium` / `--model-high`) -> `backends.<name>.model*` in `.saaga/config.yaml` -> built-in default**.

### Excluding files (.saagaignore)

Create a `.saagaignore` file in the project root to exclude source files
or directories from Saaga's documentation scope. Excluded files are
omitted from baseline generation and will not trigger documentation
updates during `saaga update`.

The syntax follows gitignore conventions (globs, negation with `!`,
trailing `/` for directories). `.gitignore` rules are also honored
automatically. The generated docs directory (`saaga-docs/`) and `.git/`
are always excluded regardless of ignore files.

Nested `.saagaignore` files inside subdirectories apply to their subtree
only, with "deepest match wins" semantics.

```gitignore
# Vendored dependencies and build output
vendor/
dist/

# Lock files
package-lock.json

# Generated assets
*.min.js
*.map
```

## Unstable features

> **Do not use unstable features unless you are a Saaga core developer or
> you explicitly accept the maintenance burden described below.**
>
> Unstable features are under heavy development and target a future stable
> release of Saaga. They are **exempt from semantic-versioning guarantees**
> and may introduce breaking changes in any release, including patch
> releases. Your setup **will** most likely break multiple times before the
> feature stabilizes, and you are responsible for fixing it yourself.
> Breaking changes that only affect unstable features will **not** appear
> in the release notes of stable Saaga releases.

Saaga lets you opt in to experimental behavior via the `unstableFeatures`
config key or the repeatable `--unstable-feature` CLI flag. Both sources
are unioned and deduplicated: config entries are applied first, then CLI
additions.

```yaml
# .saaga/config.yaml
unstableFeatures:
  - none
```

```bash
saaga update --unstable-feature none
```

When any unstable feature is enabled, a `[WARN]` line listing the active
features is printed to stderr before any other work (including the cost
confirmation prompt). If a configured or CLI-specified feature name is
not recognized, the program exits immediately with an error.

### Available unstable features

| Name   | Description |
| ------ | ----------- |
| `none` | No-op feature for verifying the unstable-feature plumbing |

## Permissions

Saaga restricts each agent backend to the minimum permissions it needs.
Two guarantees hold on every backend:

- **No arbitrary shell.** The agent cannot run commands of its choosing.
- **Nothing outside the workspace.** Reads and writes are confined to the
  app tree (including gitignored build output). The run directory lives
  inside the workspace at `.saaga-runs/`.

Within the workspace, writes are meant to be limited to
`<app>/<docs_dir>/**` and the run directory, leaving source code, rule
files, and `BASELINE` untouched. How completely that holds depends on the
backend, because the three CLIs expose very different permission systems:

| Backend | Mechanism | Writes scoped in workspace | Restricted shell |
| ------- | --------- | -------------------------- | ---------------- |
| cursor  | Generated `cli-config.json` pointed at by `CURSOR_CONFIG_DIR`, enumerating denied paths plus explicit `Shell(cd:*)`, `Shell(ls:*)`, `Shell(pwd:*)`, `Shell(grep:*)`, `Shell(head:*)`, `Shell(tail:*)`, `Shell(wc:*)`, `Shell(dirname:*)`, `Shell(basename:*)`, and `Shell(git:*)` allows. Uses `--trust` instead of `--force`. | Yes | Yes |
| copilot | `--available-tools` limits the model to file tools plus `bash`; `--allow-tool` permits only the restricted utility and read-only Git shell patterns, and `--disallow-temp-dir` closes temp-directory access. | No | Yes |
| claude  | `--permission-mode dontAsk` with an inline `--settings` JSON carrying `Edit` allow rules, scoped `Bash(...)` allows for the restricted shell policy, explicit `Bash(...)` denies for Claude's built-in read-only extras outside that policy, a deny list that cuts the remaining toolset down to `Read`/`Write`/`Edit`/`Bash`, plus `--strict-mcp-config`. | Yes | Yes |

Copilot is the outlier: the adapter does not yet translate the profile's
write roots and denied paths into Copilot file permission patterns, so writes
cannot be narrowed below the workspace boundary. Treat review and branch
protection as the backstop there rather than the agent profile.

The restricted shell policy allows utility commands (`cd`, `ls`, `pwd`,
`grep`, `head`, `tail`, `wc`, `dirname`, `basename`)
and read-only git (`log`, `show`, `diff`, `blame`, `status`, `ls-files`,
`cat-file`, `rev-parse`) on cursor, copilot, and claude. Each backend
translates these into its native rule syntax: Cursor `Shell(...)`,
Copilot `shell(...)`, and Claude `Bash(...)`.

Copilot's tool surface is narrowed with an allowlist, so anything new is
excluded by default. Claude has no exclusive allowlist — `--allowedTools`
and `permissions.allow` grant named or scoped permissions rather than
removing unrelated tools — so its unwanted tools (web access, subagents,
MCP) are denied by name, and a tool introduced in a later release will
arrive enabled. The same applies to Claude Bash: under `dontAsk`, Claude
still auto-runs a built-in read-only command set unless those commands are
denied explicitly, so the adapter pairs scoped allows with denies for
built-ins outside the restricted policy. The `claude/tool-surface` probe
asserts the surviving toolset for exactly that reason; run
`saaga doctor --level full` after upgrading a backend CLI.

Saaga does not narrow cursor's tool surface at all; its profile only
governs paths and shell. Cursor exposes MCP tools that have not been
examined here.

The effective profile is written to `<run_dir>/permissions.json` for
every run.

### Escape hatches

If a run fails because the agent cannot reach a path it needs (unusual
layouts, monorepos, symlinks), use `--allow-dir` to grant access:

```bash
saaga update --allow-dir /path/to/shared/lib
```

`--allow-dir` is repeatable and appends the path to both read and write
roots. It is deliberately not configurable via `.saaga/config.yaml` so a
workaround cannot become silent permanent state.

If you need to reproduce the legacy unrestricted behavior entirely, pass
`--dangerously-allow-all`. This omits the permission profile and uses
the original backend flags (`--force`, `--allow-all-tools`,
`--dangerously-skip-permissions`). A warning is printed on every use:

```bash
saaga init --dangerously-allow-all --backend cursor
```

### Auditing denials

Pass `--audit-permissions` to record every tool call a backend refused
during a run. Results go to `<run_dir>/permission-audit.log`, grouped by
what the refusal means rather than in the order they happened:

| Class | Meaning |
| ----- | ------- |
| `unexpected` | Refused inside a directory the profile grants. A saaga bug or backend drift — the run silently produced less than it should have. Also printed as a warning. |
| `out-of-workspace` | The agent wanted a path outside the app tree and run directory. Rerun with `--allow-dir <path>` if it genuinely needs it. |
| `protected-path` | Refused a path the profile deliberately withholds, such as `src/` or `AGENTS.md`. Working as intended. |
| `shell` | Refused a command. Expected under every profile. |
| `unknown` | The backend did not report which path was refused. |

The classification compares the refused path against the profile's read
and write roots, so it does not depend on how a backend worded the
refusal. That matters because the wording is written by the model and is
sometimes wrong about the cause — copilot has been observed explaining a
refusal as "/etc requires root privileges" when its own permission layer
had blocked the call.

To get at that information the flag switches the backend to JSON output,
so **`<run_dir>/*.log` contains JSON instead of a readable transcript for
audited runs**. A notice is printed when the flag takes effect. The flag
has no effect under `--dangerously-allow-all`, since an unrestricted run
refuses nothing.

## Diagnosing backend issues

The `doctor` command checks backend CLI availability and runs capability
probes to verify that permission restrictions are working correctly.

```bash
# Fast tier (default) — zero model calls, checks binary + version + flags
saaga doctor

# Check a specific backend
saaga doctor --backend cursor

# Full tier — makes real model calls to verify side-effect probes
saaga doctor --level full

# Machine-readable output for CI
saaga doctor --json

# Run specific probes (comma- or space-separated)
saaga doctor --level full --probe write-in-cwd,arbitrary-shell-denied
```

The fast tier is deterministic and free: it checks that each backend CLI
is on `PATH`, answers `--version`, and that its help text still documents
every flag Saaga passes during agent runs (`required-flags`). Use it
after upgrading a backend CLI to catch flag removals or renames before
they break a flow. CI runs the fast suite daily against every backend
(`.github/workflows/doctor-fast.yml`) and the full suite weekly
(`.github/workflows/doctor-full.yml`).

Full-tier probes exercise the real permission boundaries: that files
outside the workspace stay unreadable and unwritable, that a shell
command the agent cannot otherwise compute the answer to does not run,
and — where the backend supports it — that source, rule files, and
`BASELINE` reject writes. Each probe is a live agent run, so the full
tier takes several minutes and spends tokens.

### Doctor flags

| Flag | Description |
| ---- | ----------- |
| `--backend <name>` | Backend to check: `cursor`, `copilot`, `claude`, or `all` (default: `all`) |
| `--level <level>` | Probe tier: `fast` (default, zero tokens) or `full` (makes model calls) |
| `--model-low <name>` | Model override for full-tier probes (defaults to the low-tier model per backend) |
| `--json` | Output versioned JSON instead of human-readable text |
| `--probe <ids...>` | Run only the specified probe IDs |

When a full-tier probe fails, the raw agent output for each backend is
kept under `.saaga-runs/doctor/<timestamp>/<backend>.log` and the
directory is printed in the summary.

When a capability probe fails, doctor retries it up to two more times
under the same permission profile to rule out transient LLM
non-determinism. A probe that passes on retry is reported as
**transient** (flaky) rather than failed — the overall run still
succeeds, but the flaky probe is called out in the summary.

If all retries fail, doctor reruns the probe once with the permission
profile removed and reports which side the fault is on:

- **Succeeds without the profile** — the profile is too tight for this
  backend or CLI version. That is a saaga bug, or drift to fix.
- **Fails without the profile too** — the profile is not implicated; look
  at the CLI, credentials, or environment.

Probes that assert something is *refused* are not retried or rerun,
since they are meant to fail once the restriction is lifted.

### Version alignment

Probe results can vary across CLI versions. The install scripts under
`examples/install-agents/` support a `CLAUDE_CODE_VERSION` environment
variable to pin a specific Claude Code release:

```bash
CLAUDE_CODE_VERSION=2.1.220 ./examples/install-agents/install-claude.sh
```

When unset, the latest version is installed. After upgrading a backend
CLI, run `saaga doctor --level full` to verify the permission profile
still holds.

### Exit codes

| Code | Meaning |
| ---- | ------- |
| 0 | All probes passed |
| 1 | At least one probe failed |
| 2 | Could not run (binary missing, no credentials) |

### Preflight checks

Before `init` and `update` spend tokens, Saaga automatically runs the
fast-tier doctor probes for the selected backend. If the backend CLI is
not found or its version query fails, the run is refused with a
diagnostic message pointing you to `saaga doctor` for details.

## Running in containers

Although Saaga restricts agent backends to the narrow permissions they
need (see [Permissions](#permissions)), running inside a container adds
defense in depth. A container sandboxes the agent from your host
environment so even if a permission boundary were bypassed, the agent
cannot affect anything outside the mounted project directory.

[`examples/Dockerfile`](./examples/Dockerfile) provides a starting
point. It bakes Saaga and an agent backend CLI into a self-contained
image, then uses your project as a bind-mounted volume at runtime.

Build the image from the repository root:

```bash
docker build -f examples/Dockerfile -t my-saaga .
```

Run against your project:

```bash
docker run --rm -v /path/to/your/app:/workspace \
    my-saaga --backend cursor init /workspace
```

**Choosing backends** — the Dockerfile installs `cursor-agent` by
default. Uncomment or add `RUN` lines for the backends you need; helper
scripts under [`examples/install-agents/`](./examples/install-agents/)
show the install commands for each supported backend.

**Authentication** — agent CLIs need valid credentials inside the
container. Mount your credential files or pass tokens as environment
variables (e.g. `-e ANTHROPIC_API_KEY`). Saaga does not manage API keys
itself.

## Development

See [DEVELOPING.md](./DEVELOPING.md) for instructions on building and
developing Saaga itself.

## License

MIT — see [LICENSE](./LICENSE).
