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

> **Alpha stage disclaimer** — Saaga is currently in alpha stage and
> under heavy development. The features are still unstable and the produced
> documentation is still searching for it's final form. Therefore it can
> only be recommended for curious minds at this point in time. If you
> decide to use it, you need to be prepared for backward-incompatible
> changes and the fact that you will probably need to re-initialize your
> documentation when Saaga becomes stable. Consider yourself warned and
> travel safely.

## How it works

Saaga orchestrates a headless coding agent (Cursor, GitHub Copilot, or
Claude Code) through a multi-phase workflow:

1. **Analyze** — the agent studies the codebase and produces architecture
   documentation.
2. **Plan** — it identifies the domain areas that need documenting and
   creates a phased plan.
3. **Document** — each phase is written as structured domain docs
   (concepts, features, patterns, and conventions where the codebase has them).
4. **Verify** — a self-critic loop reviews each phase and fixes the errors
   that make a document wrong; minor findings are recorded and the slice
   moves on.
5. **Baseline** — a content snapshot is saved so future runs only
   re-document what actually changed.

## What you get

After `saaga run init`, your project contains:

- **`saaga-docs/`** — structured domain documentation organized into
  four categories:
  - **Concepts** — what something is and where it lives (architecture,
    data models, configuration).
  - **Features** — end-to-end feature specifications (workflows, user
    flows, edge cases). Internal machinery counts: a feature whose actor
    is the system describes a *Mechanism* rather than a user flow.
  - **Patterns** — how to do common operations (adding endpoints,
    extending workflows, testing).
  - **Conventions** — what things must be named or shaped like (naming,
    file layout, error messages). Capped at 20 lines each, one file per
    convention *family*, and present only when the codebase has rules
    worth stating.

  Patterns and conventions are separated by one line: a rule that requires
  reading code flow is a pattern; a rule you could check with grep is a
  convention. It matters because the two rot differently — a pattern goes
  stale when the code it describes changes, a convention only when the team
  changes its mind.

- **Always-on agent rules** — Saaga installs guidance into the rule
  files your agent already reads, telling it to consult `saaga-docs/`
  before exploring source. Supported targets:

  | Target | File |
  | ------ | ---- |
  | `agentsmd` | `AGENTS.md` (managed block) |
  | `cursor` | `.cursor/rules/domain-docs.mdc` |
  | `claude` | `CLAUDE.md` (managed block) |
  | `copilot` | `.github/instructions/domain-docs.instructions.md` |

- **`saaga-docs/ARCHITECTURE.md`** — a system overview: the overall
  architecture and a short description of each module.

- **`saaga-docs/README.md` and `saaga-docs/GLOSSARY.md`** — a generated
  entry point and term index (see [Generated files](#generated-files)).

- **`saaga-docs/BASELINE`** — a content manifest that lets `saaga run update`
  detect what changed and re-document only the affected areas.

- **`saaga-docs/FORMAT`** — the corpus format version (see
  [Corpus format version](#corpus-format-version)).

Every generated document opens with a YAML frontmatter block naming its
title, type, and the source paths its claims describe. Verification stamps
a `last_verified` date on each document it found nothing wrong with; a
document without the stamp has a verification pending. Later runs use these
fields to tell a fresh document from a stale one.

Documents are written to a length budget set by how central their subject
is, not by how much source there is to describe, and the plan as a whole is
held to a document count derived from the size of your codebase. Small
`update` and `quick-update` changes fold into existing documents rather than
opening new ones. Corrections are never capped.

## Prerequisites

Saaga runs on **Linux** and **macOS**. Windows is not tested natively;
Windows users should run Saaga under WSL2 or inside a container (see
[Running in containers](#running-in-containers)).

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
saaga run init --backend cursor
```

> **Heads up** — `init` is the heavy one. It drives the agent through
> several phases (analyze, plan, document, verify/fix), so it can run for
> many hours and consume a large number of tokens on a sizeable
> codebase. This is a one-time cost; afterwards you maintain the docs
> with the much cheaper `update` and `quick-update`. See
> [Runtime and cost](#runtime-and-cost) before your first run.

After code changes, update the docs incrementally:

```bash
saaga run update
```

## Commands

### `saaga run <flow> [dir]`

Run a named flow. Omit the flow name (`saaga run`) to list available
flows. All flows accept an optional `[dir]` argument that defaults to
the current working directory.

A run that is interrupted (Ctrl+C) or fails part-way can be picked up
where it stopped. Saaga prints the exact command when it happens:

```text
interrupted. To resume: saaga run --resume myapp-init-20260830-101500-2f498e6e
```

`saaga run --resume <run-id> [dir]` re-runs only the step that was in
progress and everything after it; steps that had already completed are
skipped and their results reused. `saaga run [flow] --continue [dir]`
does the same for the most recent interrupted or failed run in the
directory. The flow definition must be unchanged since the run started;
`--backend` and `--model` may differ, which is useful when the original
backend was the reason for the failure. Pressing Ctrl+C a second time
exits immediately without recording the interruption.

Built-in flows:

```text
init                  Full initial documentation (architecture +
                      plan + phases + verify/fix + baseline).

update                Detect changes since BASELINE, regenerate
                      affected slices, refresh baseline.

quick-update          Fast single-session doc update; its step takes the
                      default (cheaper) model key. Produces a metadata
                      artifact for later verification.

verify-quick-updates  Consolidate and verify all unverified
                      quick-update artifacts.
```

### Other commands

```text
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
| `--model <key>=<model>` | | Set the model a model key resolves to, e.g. `--model high=opus`. Which key a step asks for comes from the flow (repeatable; see [Model keys](#model-keys)) |
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
| `--rule-targets <targets>` | `run`, `install-rules` | Comma-separated rule targets: `agentsmd`, `cursor`, `claude`, `copilot`, `none` (used by the `init` flow) |
| `--resume <run-id>` | `run` | Resume an interrupted or failed run where it stopped; the flow name is taken from the run |
| `--continue` | `run` | Resume the most recent interrupted or failed run in the directory (of the given flow, if one is named) |

### Output locations

- **Generated docs** land in `<project>/saaga-docs/`.
- **Run artifacts** (plans, logs, status files, change reports, and the
  rendered prompt of every agent step) are written under
  `<project>/.saaga-runs/<run-id>/`. This directory is automatically
  added to `.gitignore` by `saaga run init`.
- **The structural validation report** for the run is written to
  `<project>/.saaga-runs/<run-id>/doc-validation.md` (see
  [Documentation validation](#documentation-validation)).
- **Deferred-findings reports** are written to
  `<project>/.saaga-runs/<run-id>/slice-<n>/deferred-minors.md` (and
  `architecture/` for ARCHITECTURE.md) when verification passed a slice
  with minor findings, or ran out of rounds (see
  [Verification](#verification)).

### Corpus format version

`saaga-docs/FORMAT` records which corpus format the documentation follows:

```yaml
format_version: 1
```

Every flow checks the version before invoking an agent, so a mismatch costs
no tokens:

| Situation | Result |
| --------- | ------ |
| No corpus (`saaga-docs/` absent or empty) | Passes. `saaga run init` builds the corpus and stamps the version. |
| Corpus at the current version | Passes. |
| Corpus at a different version — including one with no `FORMAT` file, which reads as version 0 | `update`, `quick-update`, and `verify-quick-updates` stop immediately with an error naming both versions and the upgrade path. |
| `init` over any existing corpus | Stops immediately: delete `saaga-docs/` first, so re-initialising is never a silent overwrite. |

To upgrade a corpus, delete `saaga-docs/` and run `saaga run init` to
regenerate it.

A version-0 corpus — one written by a pre-beta Saaga — is not migrated in
place, and no migration for it is planned. The format change is not just
frontmatter and a `FORMAT` file: it changed what gets documented and at what
depth, so an upgraded version-0 corpus would keep the over-documentation and
duplicated facts the new format exists to remove. Regenerating gives a smaller
and more accurate base than any upgrade could. In-place migration is planned
for later format versions, once the format is frozen.

### Generated files

Every documenting flow regenerates two files from the category `INDEX.md`
files:

| File | Contents |
| ---- | -------- |
| `saaga-docs/README.md` | The corpus entry point: a reading order — the architecture, then the most-referenced concepts, then the workflows — followed by links to `ARCHITECTURE.md`, the category indexes, and the glossary. |
| `saaga-docs/GLOSSARY.md` | Every term the indexes name, alphabetically, each with its one-line definition and a link to the document that owns it. |

Both are **generated, never written by an agent**, and agents are denied
write access to them alongside `BASELINE` and `FORMAT`. Hand edits would be
overwritten on the next run, so do not make them; edit the owning `INDEX.md`
row instead.

### Documentation validation

Every documenting flow finishes with a deterministic structural check of the
corpus. Four checks run over every Markdown document under `saaga-docs/`:

| Check | What it means | Result |
| ----- | ------------- | ------ |
| **Relative links** | Every `[text](./path.md)` target resolves on disk, including targets outside the corpus such as `../../src/cli.ts`. External URLs and `#anchor` suffixes are not checked. | Fails the flow |
| **Mermaid fences** | Every ` ```mermaid ` block is terminated, declares a known diagram type, and leaves no node bracket open. | Fails the flow |
| **Convention length** | Every document under `conventions/` is at most 20 lines of body, frontmatter excluded. `INDEX.md` is exempt. | Fails the flow |
| **Orphan documents** | Every document is linked from at least one other document. `INDEX.md` files and the corpus `README.md` are exempt. | Warning only |

A failure names the report, which lists every problem with its file and line:

```
saaga-docs/ has 1 broken link, 0 invalid Mermaid diagrams, and 0 over-cap
convention documents. See the report at
/path/to/project/.saaga-runs/<run-id>/doc-validation.md.
```

The check runs last, after the baseline, the format stamp, and the generated
files are written, so a failure never leaves the corpus in a state that
stops the next run — the documentation is on disk, and the report tells you
what to fix. A convention over the cap usually means the file covers two
convention families and should be split, or is a pattern in disguise and
belongs under `patterns/`.

### Verification

Every slice goes through a verify/fix loop of up to three rounds: a critic
reviews the documents against the source and a fixer acts on what it found.

A slice passes when the critic records no Critical and no Major finding.
Minor findings — a modest budget overrun, a duplicated table row — are
reported in full and do not hold the loop open. They are written to
`.saaga-runs/<run-id>/slice-<n>/deferred-minors.md`, one table per slice,
and the documents they concern lose their `last_verified` stamp until a
later run verifies them clean.

## Runtime and cost

Saaga works by driving a real coding-agent CLI, so its runtime and token
usage track whatever your backend charges — they scale with the size of
your codebase and the amount of documentation being generated. Treat the
guidance below as relative expectations, not fixed numbers.

| Command | What it runs | Expect |
| ------- | ------------ | ------ |
| `init` | Multiple agent sessions across all phases over the whole codebase | **Longest and most token-intensive.** Many hours; a large, one-time token spend. |
| `update` | Re-documents only the slices that changed since `BASELINE` | Proportional to how much changed — usually a fraction of `init`, ~20-30 minutes |
| `quick-update` | A single session, on the default (cheaper) model key | Fast and cheap; the lightest agent-backed command. ~3-10 minutes. |
| `verify-quick-updates` | One consolidation/verification session | Short; scales with the number of pending quick-update artifacts. Comparable to one `update`. |
| `install-rules` | No agent backend at all | Effectively instant; no tokens used. |

> **Token usage disclaimer** — `init` in particular can consume a
> substantial number of tokens, since it reads across your entire
> codebase and runs several agent phases including a verify/fix loop.
> Costs depend on your chosen backend and model. If you want to keep the
> initial spend down, point `--model high=<cheaper-model>` at a cheaper model
> (`init`'s steps all ask for `high`) or scope what gets documented with
> [`.saagaignore`](#excluding-files-saagaignore).

### Cost confirmation prompt

Every agent-backed command (`init`, `update`, `quick-update`,
`verify-quick-updates`) prints a cost notice before it starts, naming the
backend CLI it is about to run and reminding you that the resulting agent
usage is billed to your own account with that provider. On an interactive
terminal it then asks for confirmation:

```text
Cost notice: 'saaga run init' will run the 'cursor-agent' CLI (backend cursor, model
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
    models:
      low: claude-4.6-sonnet-medium-thinking
      medium: claude-4.6-sonnet-medium-thinking
      high: claude-4.6-opus-high-thinking
      triage: composer-2.5   # custom key, for your own flows
  claude:
    models:
      high: opus
ruleTargets: [agentsmd]    # agentsmd | cursor | claude | copilot | none
docsDir: saaga-docs        # name of the generated docs folder (default: saaga-docs)
autoApprove: false         # true skips the cost confirmation prompt (same as --yes)
unstableFeatures: []      # list of unstable features to enable (see below)
```

#### Model keys

`backends.<name>.models` is an open map of **model key** -> model name. Three keys
are built in:

| Key | Used by | Falls back to |
| --- | ------- | ------------- |
| `low` | `doctor` probes | a built-in default per backend |
| `medium` | agent steps that declare no `model:` | a built-in default per backend |
| `high` | the agent steps of `init`, `update`, `verify-quick-updates` | a built-in default per backend |

Any absent built-in key falls back to its default, so you can override just one.

Which key a step asks for is decided by the flow, not the command, so
`--model high=<model>` changes the model behind every step that asks for
`high`, across every flow. Each flow's keys are all resolved before the run
starts, so a key with no model behind it fails immediately rather than
part-way through.

You may also define keys of your own — `triage`, `review_2`, `fast-plan` — for use by
custom flows and extensions. Custom keys have **no** default: asking for one that is
not configured is an error naming the key and the keys that are available. Keys must be
lowercase, start with a letter, and otherwise contain only `a-z`, `0-9`, `-` and `_`.

Resolution order: **`--model <key>=<model>` -> `backends.<name>.models.<key>` in `.saaga/config.yaml` -> built-in default (`low`/`medium`/`high` only) -> error**.

Upgrading from a release that used `modelLow` / `modelMedium` / `modelHigh`?
See [CHANGELOG.md](./CHANGELOG.md).

### Excluding files (.saagaignore)

Create a `.saagaignore` file in the project root to exclude source files
or directories from Saaga's documentation scope. Excluded files are
omitted from baseline generation and will not trigger documentation
updates during `saaga run update`.

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

### Custom documentation instructions (.saagarules)

Create a `.saagarules` file in your project root to provide additional
instructions and context that Saaga should take into account when
documenting. The content is appended to every agent prompt during `init`,
`update`, `quick-update`, and `verify-quick-updates` workflows.

```markdown
# .saagarules

Focus on public API boundaries and integration points rather than
internal implementation details.

Our domain uses "tenant" to mean a billing entity, not a deployment unit.
Document this distinction in concept files.

Always include error-handling semantics in feature specifications.
```

**Behavior:**

- The file is read once when a workflow starts; edits during a run have no
  effect.
- Content is injected as raw UTF-8 text/Markdown. No `{var}` placeholder
  expansion is performed inside the file.
- Missing or whitespace-only files are silently ignored (no error, no
  injection).
- Files exceeding 64 KiB or containing invalid UTF-8 cause the command
  to fail immediately so instructions are never silently omitted.
- Instructions are marked as high-priority for documentation content but
  cannot override required output formats, file paths, workflow controls,
  or safety/permission constraints.
- `.saagarules` is excluded from BASELINE generation and change detection,
  so editing it alone will not trigger an `update` run.
- Under restricted mode, agents are denied permission to modify
  `.saagarules` (same protection as `AGENTS.md`).
- Only the target project root is checked; ancestor directories are not
  searched.

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
are unioned and deduplicated.

```yaml
# .saaga/config.yaml
unstableFeatures:
  - none
```

```bash
saaga run update --unstable-feature none
```

When any unstable feature is enabled, a `[WARN]` line listing the active
features is printed to stderr before any other work. An unrecognized
feature name is an error.

There are currently no unstable features; `none` is a no-op that exists
to exercise the plumbing.

## Permissions

Saaga restricts each agent backend to the minimum permissions it needs.
Two guarantees hold on every backend:

- **No arbitrary shell.** The agent cannot run commands of its choosing.
  The restricted shell allows utility commands (`cd`, `ls`, `pwd`, `grep`,
  `head`, `tail`, `wc`, `dirname`, `basename`) and read-only git (`log`,
  `show`, `diff`, `blame`, `status`, `ls-files`, `cat-file`, `rev-parse`).
- **Nothing outside the workspace.** Reads and writes are confined to the
  app tree (including gitignored build output). The run directory lives
  inside the workspace at `.saaga-runs/`.

Within the workspace, writes are limited to `<app>/<docs_dir>/**` and the
run directory, leaving source code, rule files, `BASELINE`, and `FORMAT`
untouched — on cursor and claude. **Copilot is the outlier**: its CLI does
not yet let Saaga narrow writes below the workspace boundary, so treat
review and branch protection as the backstop there rather than the agent
profile.

Because the three CLIs expose very different permission systems, the
exact tool surface an agent ends up with also differs per backend, and a
tool added in a later CLI release may arrive enabled on some backends.
Run `saaga doctor --level full` after upgrading a backend CLI to confirm
the profile still holds.

The effective profile is written to `<run_dir>/permissions.json` for
every run.

### Escape hatches

If a run fails because the agent cannot reach a path it needs (unusual
layouts, monorepos, symlinks), use `--allow-dir` to grant access:

```bash
saaga run update --allow-dir /path/to/shared/lib
```

`--allow-dir` is repeatable and appends the path to both read and write
roots. It is deliberately not configurable via `.saaga/config.yaml` so a
workaround cannot become silent permanent state.

If you need to reproduce the legacy unrestricted behavior entirely, pass
`--dangerously-allow-all`. This omits the permission profile and uses
the backends' own unrestricted flags. A warning is printed on every use:

```bash
saaga run init --dangerously-allow-all --backend cursor
```

### Auditing denials

Pass `--audit-permissions` to record every tool call a backend refused
during a run. Results go to `<run_dir>/permission-audit.log`, grouped by
what the refusal means rather than in the order they happened:

| Class | Meaning |
| ----- | ------- |
| `unexpected` | Refused inside a directory the profile grants. A saaga bug or backend drift — the run silently produced less than it should have. Also printed as a warning. |
| `out-of-workspace` | The agent wanted a path outside the app tree and run directory. Rerun with `--allow-dir <path>` if it genuinely needs it. |
| `protected-path` | Refused a path the profile deliberately withholds, such as `src/`, `AGENTS.md`, or `.saagarules`. Working as intended. |
| `shell` | Refused a command. Expected under every profile. |
| `unknown` | The backend did not report which path was refused. |

The classification compares the refused path against the profile, not the
backend's own explanation of the refusal, which is written by the model
and sometimes wrong about the cause.

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
every flag Saaga passes during agent runs. Use it after upgrading a
backend CLI to catch flag removals or renames before they break a flow.

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
| `--model low=<model>` | Model override for full-tier probes — the global `--model` flag; doctor uses the `low` key. Not backend-scoped, so under the default `--backend all` it applies to every backend probed |
| `--json` | Output versioned JSON instead of human-readable text |
| `--probe <ids...>` | Run only the specified probe IDs |

When a full-tier probe fails, the raw agent output for each backend is
kept under `.saaga-runs/doctor/<timestamp>/<backend>.log` and the
directory is printed in the summary.

A failed capability probe is retried to rule out transient model
non-determinism; a probe that passes on retry is reported as
**transient** rather than failed. If every retry fails, doctor reruns the
probe once without the permission profile and reports which side the
fault is on: a probe that succeeds without the profile points at the
profile being too tight for this CLI version (a saaga bug or drift), one
that still fails points at the CLI, credentials, or environment.

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
developing Saaga itself. How Saaga decides what to document and how much —
length budgets, the corpus budget, the single-home rule, the verification
threshold — is described in Saaga's own domain documentation under
[`saaga-docs/`](./saaga-docs/README.md) and in the prompt partials under
[`prompts/partials/`](./prompts/partials).

## License

MIT — see [LICENSE](./LICENSE).
