# Developing Saaga

This document covers building, testing, and extending Saaga itself. For
using Saaga on your own projects, see [README.md](./README.md).

## Getting started

```bash
git clone <repo-url>
cd saaga
pnpm install
pnpm build          # tsc → dist/
```

The compiled CLI lives at `dist/cli.js` and is exposed as the `saaga`
bin (see `package.json`).

During development, run directly from source without building:

```bash
pnpm dev <subcommand> [args]
```

## Running tests

```bash
pnpm test           # vitest run
pnpm test:watch     # vitest watch
```

## Evaluation harness

`eval/` holds a paired eval harness measuring whether the `saaga-docs/`
corpus helps a coding agent on this repo — answer tasks graded by
pre-registered regexes plus code tasks graded by running the feature's
real vitest files against the sandbox. Its smoke tests and a drift guard
(which verifies the code-task stubs still match the source tree) run
inside `pnpm test` with the fake agent and cost nothing. Real runs invoke
an agent CLI and spend tokens:

```bash
pnpm eval --dry-run                                  # print the run matrix
pnpm eval                                            # no-docs vs saaga-docs, 2 reps
pnpm eval:report --run eval/results/run-<timestamp>  # write eval/reports/<name>.md
pnpm eval:artifact                                   # HTML readout over all reports
```

Raw results are gitignored under `eval/results/`; reports are committed
under `eval/reports/`. Method and caveats: [eval/README.md](./eval/README.md).

## Repository layout

| Directory | Contents |
| --------- | -------- |
| `src/` | TypeScript source — CLI, engine, agents, scripts |
| `flows/` | Flow YAML files (one per subcommand) |
| `prompts/` | Prompt templates with `{var}` placeholders |
| `prompts/partials/` | Shared methodology pulled in with `{include:...}` |
| `rules/` | Rule stub templates installed by `install-rules` |
| `saaga-docs/` | Domain documentation (concepts, features, patterns, conventions) |
| `examples/` | Dockerfile, agent install scripts |
| `eval/` | Paired documentation-value eval harness (not shipped) |
| `.devcontainer/` | Dev container configuration |

## Domain documentation

The `saaga-docs/` directory contains the authoritative source for
understanding the system. **Always read the domain documentation before
exploring source code.**

- [Concepts](./saaga-docs/concepts/INDEX.md) — what something is and
  where it lives (agent interface, flow DSL, scope, templates, configuration).
- [Features](./saaga-docs/features/INDEX.md) — end-to-end feature
  specifications (init workflow, update workflow, verify/fix loop).
- [Patterns](./saaga-docs/patterns/INDEX.md) — how to do common
  operations (adding backends, adding flow primitives, creating prompts).
- Conventions — what things must be named or shaped like. This category is
  optional and Saaga's own corpus has none yet; when it does, its index is at
  `saaga-docs/conventions/INDEX.md`.

## Extending Saaga

The domain docs include step-by-step patterns for common extensions:

- [Adding agent backends](./saaga-docs/patterns/adding-agent-backends.md)
- [Adding CLI subcommands](./saaga-docs/patterns/adding-cli-subcommands.md)
- [Adding flow primitives](./saaga-docs/patterns/adding-flow-primitives.md)
- [Adding built-in scripts](./saaga-docs/patterns/adding-built-in-scripts.md)
- [Creating prompt templates](./saaga-docs/patterns/creating-prompt-templates.md)
- [Writing flow YAML files](./saaga-docs/patterns/writing-flow-yaml-files.md)
- [Testing with FakeAgent](./saaga-docs/patterns/testing-with-fake-agent.md)
- [Customizing the verify/fix loop](./saaga-docs/patterns/customizing-verify-fix-loop.md)

## Unstable features

Unstable features are gated behind a typed registry in
`src/unstable-features.ts`. The `UNSTABLE_FEATURES` tuple is the single
source of truth for available feature names; adding an entry there
automatically makes it available in `.saaga/config.yaml` and via the
`--unstable-feature` CLI flag.

### Querying in code

Use the typed helper anywhere in the codebase:

```typescript
import { isUnstableFeatureEnabled } from "./unstable-features.js";

if (isUnstableFeatureEnabled("none")) {
  // feature-gated behavior
}
```

The argument is typed as `UnstableFeature`, so the compiler rejects
unknown names. The process-wide set is initialized once per `runCli()`
invocation and reset between calls, preventing state leakage in tests.

### Adding a new unstable feature

1. Add the feature name to the `UNSTABLE_FEATURES` tuple in
   `src/unstable-features.ts`.
2. Gate runtime behavior behind `isUnstableFeatureEnabled("your-feature")`.
3. List the feature in the "Unstable features" section of `README.md`.
4. Add tests that enable the feature and verify the gated behavior.

## Flows and prompts

The orchestration logic ships as YAML, not code. `saaga run <flow>`
executes a named flow file:

- [`flows/architecture.flow.yaml`](./flows/architecture.flow.yaml)
- [`flows/init.flow.yaml`](./flows/init.flow.yaml)
- [`flows/update.flow.yaml`](./flows/update.flow.yaml)
- [`flows/quick-update.flow.yaml`](./flows/quick-update.flow.yaml)
- [`flows/verify-quick-updates.flow.yaml`](./flows/verify-quick-updates.flow.yaml)
- [`flows/slice.flow.yaml`](./flows/slice.flow.yaml)

Edit them to add steps, swap prompts, adjust the verify/fix iteration
cap, or wire in your own scripts. The DSL primitives are `agent`,
`script`, `loop`, `foreach`, `if`, `commit`, and `read-file`.

Prompt templates live in [`prompts/`](./prompts) and use `{var}`
placeholders filled from the flow YAML's `vars:` block.

Shared methodology — the document templates, decision guidance, the
level-of-detail policy, quality checklists, the verification protocol —
lives once in
[`prompts/partials/`](./prompts/partials) and is pulled into the prompts
that need it with an include directive:

```markdown
{include:partials/concept-template.md}
```

Includes are resolved before `{var}` substitution, so placeholders inside
a partial still resolve. Each path is looked up in the including file's
own directory first, then in the roots the caller passes (today just
`prompts/`). Partials may include other partials; cycles, excessive
nesting and paths that escape the roots are errors.

Two rules split across both homes. **Level of detail**: the static half —
the budget bands, the consequence test, the amortization rule — lives in
[`partials/lod-policy.md`](./prompts/partials/lod-policy.md) so the writer
and the verifier read identical text. The dynamic half — which budget each
document gets, and how much this run is allowed to grow the corpus — is a
per-run decision, so it lives in the planning prompts and is recorded in
the plan. The corpus-level ceilings are described in the
[Corpus Budget](./saaga-docs/concepts/corpus-budget.md) concept.

**Single home per fact** splits the same way: which class of fact each
document type owns lives in
[`partials/single-home.md`](./prompts/partials/single-home.md), while what
*this* corpus's documents own and reference is a per-run decision the plan
records. `ARCHITECTURE.md` is the exception that needs a third place: it is
written before the plan exists, so its writing target lives in
[`document-architecture.md`](./prompts/document-architecture.md) and the
number the verifier grades comes from the plan. It has a verify/fix pass of
its own in `init`, using
[`verify-architecture.md`](./prompts/verify-architecture.md) — the shared
verifier is scoped to a plan phase and to the four category directories, and
ARCHITECTURE.md is in neither.

**The verify/fix threshold** splits the same way. `loop` binds `${iteration}`
and `${loop_max}` in its body, and the flows hand both to every verifier along
with `deferred_minors_path` — that is the entire extent of the engine's
involvement. What the numbers *mean* — that a `FAIL` on the last round is final,
so its findings are recorded rather than retried — lives in the two verify
prompts, together with the per-document `last_verified` rule and the report's
format
([`partials/deferred-findings.md`](./prompts/partials/deferred-findings.md),
shared by both verifiers). A verify step moved out of a loop would leave both
variables undefined and abort the run on the first render, so
`tests/flows.test.ts` asserts that every verifier sits inside one. The
user-facing summary is under [Verification](./README.md#verification) in
the README.

The split matters: **prompts carry methodology, generated plans carry
decisions.** A plan records what this run does — which documents to write,
which files to read, which templates need repository-specific deltas — and
never restates a template or a checklist. The writer and verifier get those
from their own prompts, so they arrive verbatim rather than paraphrased
through a generated plan.

> Note: customizing flows currently requires editing files in the Saaga
> repository itself. First-class support for customizing flows from your
> own project, without modifying Saaga's source, is planned.

## Scheduled maintenance

Two GitHub Actions run `saaga doctor` against every backend to catch CLI
drift: the fast suite daily (`.github/workflows/doctor-fast.yml`) and the
full suite weekly (`.github/workflows/doctor-full.yml`).

Two more keep `saaga-docs/` current by running Saaga from the
repository source on `main`. Both rely on `.saaga/config.yaml` as the
single source of truth for backend, model, and approval settings; only
`--ci` is passed on the command line.

| Workflow | Schedule (UTC) | Commands |
| -------- | -------------- | -------- |
| `quick-update-nightly.yml` | 00:00 Sun, Tue–Sat | `saaga run quick-update` |
| `verify-quick-updates-weekly.yml` | 00:00 Mon | `saaga run quick-update` then `saaga run verify-quick-updates` |

Monday's weekly run replaces the nightly quick-update for that day, so
every night of the week is covered exactly once.

After Saaga finishes, `.github/scripts/publish-saaga-changes.sh`
classifies the output:

- **Documentation only** (`saaga-docs/**`): committed and pushed
  directly to `main` via the Saaga GitHub App.
- **Mixed changes**: committed on a branch and opened as a PR for human
  review.
- **No changes**: exits successfully with nothing to publish.

If `main` advanced while the workflow was running, the publish step
fails safely with a rerun instruction instead of force-pushing.

Both workflows share a `saaga-maintenance` concurrency group
(`cancel-in-progress: false`) to avoid overlapping runs.

### Required Actions configuration

| Kind | Name | Purpose |
| ---- | ---- | ------- |
| Secret | `CURSOR_API_KEY` | Backend credentials for `cursor-agent` |
| Secret | `SAAGA_APP_PRIVATE_KEY` | Saaga GitHub App private key (`.pem`) |
| Variable | `SAAGA_APP_ID` | Saaga GitHub App ID |

The Saaga GitHub App must be installed on the repository with
**Contents: read/write** and **Pull requests: read/write** permissions,
and granted bypass on `main` branch protection so it can push
docs-only commits directly.

### Manual reruns

Both workflows support `workflow_dispatch` for on-demand runs
independent of the cron schedule.

## Devcontainer

A Node-only dev container ships under
[`.devcontainer/`](./.devcontainer/). Agent CLIs are installed via the
`postCreateCommand` hook (`install-agents.sh`), which is shipped empty.
Populate it from the helpers under
[`examples/install-agents/`](./examples/install-agents/) to match the
backends you want available during development.

To build a self-contained image, see
[`examples/Dockerfile`](./examples/Dockerfile).
