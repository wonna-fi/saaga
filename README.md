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

| Backend  | CLI              | Default model                   |
| -------- | ---------------- | ------------------------------- |
| cursor   | `cursor-agent`   | `claude-4.6-opus-high-thinking` |
| copilot  | `copilot`        | `claude-sonnet-4.5`             |
| claude   | `claude`         | `opus`                          |

> **Sandbox recommendation** — The agent backend runs with broad
> autonomy over the filesystem. It is recommended to run Saaga inside a
> container to sandbox the agent from your host environment. See
> [Running in containers](#running-in-containers-recommended) below.

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
```

### Global flags

| Flag | Short | Description |
| ---- | ----- | ----------- |
| `--backend <name>` | `-b` | Agent backend: `cursor`, `copilot`, or `claude` |
| `--model <name>` | `-m` | Override the per-backend default model |
| `--ci` | | Plain (non-color) log output, suitable for CI pipelines |
| `--version` | `-v` | Print the version and exit |

### Subcommand-specific flags

| Flag | Subcommands | Description |
| ---- | ----------- | ----------- |
| `--rule-targets <targets>` | `init`, `install-rules` | Comma-separated rule targets: `agentsmd`, `cursor`, `claude`, `copilot`, `none` |

### Output locations

- **Run artifacts** (plans, status files, change reports) are written
  under `$SAAGA_DIR/runs/<run-id>/` (defaults to `$HOME/.saaga/runs/`).
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
> initial spend down, point `--model` at a cheaper model or scope what
> gets documented with [`.saagaignore`](#excluding-files-saagaignore).

## Configuration

Create `.saaga/config.yaml` in your project directory to set persistent
defaults. All keys are optional; CLI flags always take precedence.

```yaml
# .saaga/config.yaml
backend: cursor            # cursor | copilot | claude
model: opus                # model for standard subcommands
quickModel: sonnet         # model for quick-update subcommand
ruleTargets: [agentsmd]    # agentsmd | cursor | claude | copilot | none
docsDir: saaga-docs        # name of the generated docs folder (default: saaga-docs)
```

Resolution order: **CLI flag -> `.saaga/config.yaml` -> built-in default**.

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

## Running in containers (recommended)

The agent backend executes with broad autonomy over the filesystem and
network. Running Saaga inside a container sandboxes it from your host
environment so the agent cannot affect anything outside the mounted
project directory.

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
