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
   (concepts, features, patterns).
4. **Verify** — a self-critic loop reviews each phase and fixes issues
   before moving on.
5. **Baseline** — a content snapshot is saved so future runs only
   re-document what actually changed.

## What you get

After `saaga run init`, your project contains:

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

- **`saaga-docs/BASELINE`** — a content manifest that lets `saaga run update`
  detect what changed and re-document only the affected areas.

- **`saaga-docs/FORMAT`** — the corpus format version (see
  [Corpus format version](#corpus-format-version)).

- **`saaga-docs/README.md` and `saaga-docs/GLOSSARY.md`** — a generated entry
  point and term index (see [Navigation layer](#navigation-layer)).

Every generated document opens with a YAML frontmatter block:

```markdown
---
title: Scope and Expressions
type: concept
last_verified: 2026-08-29
sources:
  - src/engine/expression.ts
---
```

| Field | Written by | Meaning |
| ----- | ---------- | ------- |
| `title` | the writer | The document's title — the same text as its heading. |
| `type` | the writer | `concept`, `pattern`, `feature`, `architecture`, or `index`. |
| `sources` | the writer | Source paths and globs whose behaviour the document's claims describe. |
| `last_verified` | verification only, on PASS | ISO date of the last verification pass that found no errors. |
| `terms` | the writer, optionally | Extra names this document is the home for — synonyms and sub-concepts a reader might look up. Feeds the generated glossary. |

`sources` and `last_verified` are what later runs use to tell a fresh document
from a stale one: a document whose sources changed after it was last verified
is a candidate for re-verification. Field names follow OKF v0.1 where they
overlap, so external tooling can read the corpus without a translation layer.

`terms` carries *names only*, never definitions. The glossary copies each
definition from the document's INDEX row, so a term listed here gets its
meaning from the one place that already holds it.

Documents written before this format existed have no frontmatter. Saaga
tolerates them everywhere — they flow through every command unchanged — but
they cannot participate in staleness selection until they are regenerated.

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

Built-in flows:

```text
init                  Full initial documentation (architecture +
                      plan + phases + verify/fix + baseline).

update                Detect changes since BASELINE, regenerate
                      affected slices, refresh baseline.

quick-update          Fast single-session doc update using a cheaper
                      model. Produces a metadata artifact for later
                      verification.

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
| `--model <key>=<model>` | | Set the model for a model key, e.g. `--model high=opus` (repeatable; see [Model keys](#model-keys)) |
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

### Output locations

- **Run artifacts** (plans, status files, change reports) are written
  under `<project>/.saaga-runs/<run-id>/`. This directory is
  automatically added to `.gitignore` by `saaga run init`.
- **Rendered prompts** for every agent step are archived under
  `<project>/.saaga-runs/<run-id>/prompts/`, exactly as the agent
  received them. Together with the plan they make a run reproducible.
- **The structural validation report** for the run is written to
  `<project>/.saaga-runs/<run-id>/doc-validation.md` (see
  [Documentation validation](#documentation-validation)).
- **Generated docs** land in `<project>/saaga-docs/`.

### Corpus format version

`saaga-docs/FORMAT` records which corpus format the documentation follows:

```yaml
format_version: 1
```

The version covers the whole corpus format — the directory layout, the document
templates, and the frontmatter schema — and it travels with the corpus rather
than living in `.saaga/config.yaml`, so a checkout or a copy carries its own
format identity.

Verification compares each document against the templates of the Saaga that is
running. Pointing a newer Saaga at an older corpus would therefore fail every
touched document on structure alone and send the fix loop into an expensive,
unintended rewrite. To prevent that, every flow checks the version before doing
anything else:

| Situation | Result |
| --------- | ------ |
| No corpus (`saaga-docs/` absent or empty) | Passes. `saaga run init` builds the corpus and stamps the version. |
| Corpus at the current version | Passes. |
| Corpus at a different version — including one with no `FORMAT` file, which reads as version 0 | `update`, `quick-update`, and `verify-quick-updates` stop immediately with an error naming both versions and the upgrade path. |
| `init` over any existing corpus | Stops immediately: delete `saaga-docs/` first, so re-initialising is never a silent overwrite. |

The check runs as the first step of the flow, before any agent is invoked, so a
mismatch costs no tokens. To upgrade a corpus, delete `saaga-docs/` and run
`saaga run init` to regenerate it. (A `saaga migrate` command will upgrade in
place once the format is frozen.)

### Navigation layer

Every documenting flow regenerates two files before validating the corpus:

| File | Contents |
| ---- | -------- |
| `saaga-docs/README.md` | The corpus entry point: a reading order — the architecture, then the core concepts, then the workflows — followed by links to `ARCHITECTURE.md`, the three category indexes, and the glossary. |
| `saaga-docs/GLOSSARY.md` | Every term the indexes name, alphabetically, each with its one-line definition and a link to the document that owns it. |

Both are **generated, never written by an agent**. A newcomer's entry point and
a term index are entirely derivable from the INDEX files, so deriving them costs
no tokens and — more importantly — they cannot drift away from the documents
they describe. Every definition in the glossary is the description cell of the
owning INDEX row, copied verbatim. **A term whose definition cannot be extracted
from an INDEX is omitted, not invented**: there is no second home for any fact.

The README's core concepts are chosen by counting inbound links across the
corpus and taking the four most-referenced concept documents, ties broken by
INDEX row order. The most-linked document is the one everything else assumes,
which is what a newcomer should read first — and because the list is computed,
it follows the corpus instead of going stale beside it.

A document can claim additional terms through its `terms` frontmatter field.
When two documents claim the same term — Saaga's own `phase` means both a
progress-display unit and a plan work unit — the glossary renders a "see also"
entry naming both homes with their own definitions, rather than silently
picking one.

Generation is idempotent: a second run over an unchanged corpus produces a
byte-identical file. Nothing dated or counted goes into either page, and the
generated files are excluded from the corpus view before anything is computed,
so one run's output can never steer the next one's.

Both files are on the agent write-deny list alongside `BASELINE` and `FORMAT`.
Hand edits would be silently overwritten on the next run, so they are refused
instead. Agents can still read them.

Content defects never fail a run: a malformed INDEX row, a term whose document
has no INDEX row, or a missing `ARCHITECTURE.md` produces a warning and is
omitted from the output. A row pointing at a document that no longer exists is
dropped rather than copied — the validation pass that follows treats a broken
link as fatal, and a stale INDEX row should not become a failed run.

Linking `ARCHITECTURE.md` from the generated README is also what resolves the
one orphan the validator would otherwise report on every run.

### Documentation validation

Every documenting flow — `init`, `update`, `quick-update`, and
`verify-quick-updates` — finishes with a deterministic structural check of the
corpus. (In the update family the check is part of the update itself, so a run
that finds nothing to do skips it along with everything else.)

Link integrity, diagram validity, and reachability are facts a program can decide,
so they are decided in code rather than left to the verification agent — that makes
them reliable, costs no tokens, and frees the verify pass for the semantic questions
only a model can answer.

Three checks run over every Markdown document under `saaga-docs/`:

| Check | What it means | Result |
| ----- | ------------- | ------ |
| **Relative links** | Every `[text](./path.md)` target resolves on disk. Targets outside the corpus (a link to real source, e.g. `../../src/cli.ts`) are checked too. External URLs and `#anchor` suffixes are not. | Fails the flow |
| **Mermaid fences** | Every ` ```mermaid ` block is terminated, declares a known diagram type, and leaves no node bracket open. | Fails the flow |
| **Orphan documents** | Every document is linked from at least one other document. `INDEX.md` files and the corpus `README.md` are entry points and are exempt; `ARCHITECTURE.md` is not, because the generated README is what links it. | Warning only |

A failure names the report, which lists every problem with its file and line:

```
saaga-docs/ has 1 broken link and 0 invalid Mermaid diagrams.
See the report at /path/to/project/.saaga-runs/<run-id>/doc-validation.md.
```

The report is written whenever there is a corpus to check, pass or fail. The check
runs *after* the baseline, the format stamp, and the navigation layer are written,
so a failure never leaves the corpus in a state that stops the next run — the
documentation is on disk, and the report tells you what to fix. Running last also
means the generated `README.md` and `GLOSSARY.md` are themselves validated: a
generator that emitted a broken link fails the run rather than shipping.

Orphans only warn because an unlinked document is still correct, just unreachable.
An absent or empty `saaga-docs/` passes with no report: there is nothing to check
yet.

**On Mermaid validation.** Saaga does not depend on Mermaid. The real `mermaid`
package needs a DOM, and `@mermaid-js/parser` pulls in Langium while not even
covering `flowchart` — both are disproportionate for a package that ships five
production dependencies. The check is instead a small parse-only pass: the fence
must be closed, the diagram type must be one it recognises, the flowchart direction
token must be valid, and a flowchart must leave no node bracket open. That catches
the failure that actually happens — a diagram the writer truncated or mangled —
without pretending to validate Mermaid's full grammar.

The bracket rule is deliberately narrow, because failing a *valid* diagram is worse
than missing an invalid one: it aborts a run whose corpus is already on disk. So it
applies to flowcharts only (other diagram types use the same characters as grammar —
`erDiagram` writes cardinality as `||--o{`, whose brace never closes), it ignores
unmatched closing brackets (the asymmetric node `A>text]` is valid), and it skips
anything inside quotes. A valid diagram whose type is not recognised is a one-line
addition to `MERMAID_DIAGRAM_TYPES` in `src/docs/validate.ts`.

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
> initial spend down, point `--model high=<cheaper-model>` at a cheaper model or scope
> what gets documented with [`.saagaignore`](#excluding-files-saagaignore).

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
are built in and used by the bundled flows:

| Key | Used by | Falls back to |
| --- | ------- | ------------- |
| `low` | `doctor` probes | a built-in default per backend |
| `medium` | `quick-update` | a built-in default per backend |
| `high` | `init`, `update`, `verify-quick-updates` | a built-in default per backend |

Any absent built-in key falls back to its default, so you can override just one.

You may also define keys of your own — `triage`, `review_2`, `fast-plan` — for use by
custom flows and extensions. Custom keys have **no** default: asking for one that is
not configured is an error naming the key and the keys that are available. Keys must be
lowercase, start with a letter, and otherwise contain only `a-z`, `0-9`, `-` and `_`.

Resolution order: **`--model <key>=<model>` -> `backends.<name>.models.<key>` in `.saaga/config.yaml` -> built-in default (`low`/`medium`/`high` only) -> error**.

> **Migration** — the `modelLow`, `modelMedium` and `modelHigh` config fields and the
> `--model-low` / `--model-medium` / `--model-high` flags were removed. Move them under
> `models:` as `low` / `medium` / `high`; a config still using the old fields fails with a
> `ConfigError` naming the replacement.

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
are unioned and deduplicated: config entries are applied first, then CLI
additions.

```yaml
# .saaga/config.yaml
unstableFeatures:
  - none
```

```bash
saaga run update --unstable-feature none
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
files, `BASELINE`, and `FORMAT` untouched. How completely that holds depends on the
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
saaga run update --allow-dir /path/to/shared/lib
```

`--allow-dir` is repeatable and appends the path to both read and write
roots. It is deliberately not configurable via `.saaga/config.yaml` so a
workaround cannot become silent permanent state.

If you need to reproduce the legacy unrestricted behavior entirely, pass
`--dangerously-allow-all`. This omits the permission profile and uses
the original backend flags (`--force`, `--allow-all-tools`,
`--dangerously-skip-permissions`). A warning is printed on every use:

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
| `--model low=<model>` | Model override for full-tier probes — the global `--model` flag; doctor uses the `low` key. Not backend-scoped, so under the default `--backend all` it applies to every backend probed |
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
