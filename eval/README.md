# Paired eval harness

Answers one question: **does the `saaga-docs/` corpus measurably help a coding agent work on
this repo?** The same pre-registered tasks run in isolated sandboxes under different
documentation conditions; per-task check scripts score each run; the report compares success
rate and cost per condition. This directory is repo material only — it is not part of the
published package.

## Method

### Conditions

| Condition | Sandbox state |
|---|---|
| `no-docs` | `saaga-docs/` deleted; the `## Documentation` routing section stripped from AGENTS.md (CLAUDE.md is a symlink to it); `.saagarules`, `.cursor/rules/`, `.github/instructions/` removed if present |
| `saaga-docs` | The tracked tree as-is |
| `docs-only` | **Closed-book**: only `saaga-docs/`, AGENTS.md (+ CLAUDE.md symlink) and `.gitignore` survive — source, tests, flows, prompts, README/DEVELOPING and `.saaga/` are removed. Neutral half measures corpus **coverage/depth**; defect half measures corpus **accuracy** (an agent faithfully repeating a stale claim fails, which is the corpus being wrong, measured). Immune to the ceiling effect where a strong model answers everything from source |
| `openwiki` | **Stubbed.** Requires `--openwiki-dir <pre-generated wiki>`; applies the no-docs strip, then copies the wiki in. Generating a wiki is not implemented |

Each (task × condition × repetition) gets a fresh sandbox: the tracked tree is exported with
`git archive` at a pinned revision, mutated for the condition **before** a single synthetic
commit re-initializes it. No history survives — the restricted shell allows read-only git, so
a cloned or worktree sandbox would let a no-docs agent recover the corpus with `git show`.
Mutating before the commit also keeps deletions out of `git status`.

Answer-key material is stripped from **every** sandbox regardless of condition: `eval/`
(task prompts and check regexes) and `plans/` (the seed analysis with labeled truths and
stale claims) would let an agent look up graded answers instead of solving from docs or
source. Both arms lose the same material, so the comparison stays fair.

Agents run with a purpose-built permission profile (read whole sandbox, write whole sandbox +
run dir, restricted shell). The restricted shell also equalizes conditions: no arm can run
tests or arbitrary commands.

### Task set: two halves, two kinds (task-set v2)

- **Neutral half** (`eval/tasks/neutral/`): depth-preservation probes and verified anchor facts
  from `plans/eval-seed-material.md` (labeled fair to both corpora there), three tasks derived
  from real merged PRs, and six **code tasks** (below). **Only this half supports the headline
  claim.**
- **Defect half** (`eval/tasks/defect/`): regression probes for the four confirmed stale doc
  claims plus term-collision probes. Interpretation revised after the v1 baselines: in
  open-book arms this half is void (agents cross-check stale docs against source and are not
  misled); closed-book against the pre-refactor corpus it is defeated by duplication (the
  corpus states the same facts in multiple homes, only some stale, and retrieval finds a
  correct duplicate). Its binding use is docs-only against the *regenerated* corpus; the
  milestone's "stale claims gone" criterion is checked by a deterministic grep for the four
  stale strings, not by agents.

### Code tasks (the headline pass-rate instrument)

Answer-shaped QA saturates at strong model tiers (v1 baselines: 67/68 open-book). Six
`kind: "code"` tasks grade by execution instead: `prepare()` overwrites a feature's
implementation with a committed stub fixture (`eval/tasks/neutral/fixtures/` — exports and
types kept, bodies throw "not implemented") before the sandbox's initial commit, the agent
re-implements it from the docs and the target test files (readable in the sandbox; the
restricted shell still prevents *executing* anything), and after the agent finishes a trusted
host-side checker (`checkTests()`) restores the test files and configs from the initial
commit — so editing the tests cannot pass — symlinks the host's `node_modules` in, and runs
the feature's existing vitest files. Pass = exit 0.

Code tasks run in `no-docs`/`saaga-docs`/`openwiki` only (there is no source tree to
re-implement into closed-book); applicability lives in `eval/src/registry.ts`, not in task
modules, so the condition-blindness guard stays intact. A drift guard
(`eval/code-tasks.test.ts`) proves in CI that every stub still breaks its target tests and
every real implementation still passes them; a legitimate fixture refresh is a task-set
version bump. Note the test files double as the specification — doc leverage may therefore
show up as cost-to-success more than as pass rate.

### Primary endpoints (pre-registered)

1. **Code-task pass rate**, `no-docs` vs `saaga-docs` (the instrument with dynamic range).
2. **Cost-to-success for the QA tasks in open-book arms**: at a strong tier both arms pass,
   so the discriminating signal is cache-read tokens / turns / elapsed at equal success.
3. **Closed-book QA success** (`docs-only`): corpus coverage and accuracy, ceiling-free.

### Task-set versioning

`TASK_SET_VERSION` (`eval/src/registry.ts`) is stamped into every run's spec and bumped on
ANY change to task membership, a prompt, a check predicate, a `prepare()`/stub fixture, or
condition scoping. `eval:report --base/--candidate` refuses to compare different versions —
a bump means both sides of any comparison must be re-run. The committed 2026-08-23 baselines
are **v1** (17 answer tasks) and remain valid v1 evidence; v2 starts a fresh baseline set.

Trim-verification probes from the seed file are deliberately *not* tasks: rewarding recall of
over-documented trivia would score the very over-documentation the docs refactor removes. They
remain a grep checklist for the regeneration milestone.

### Pre-registration and condition blindness

Every prompt and check predicate is committed before any real condition runs. Checks are plain
regexes over the agent's `ANSWER.md` (plus file-state predicates for code tasks); they receive
only the sandbox, never the condition. A test (`eval/registry.test.ts`) mechanically forbids
task modules from referencing the docs corpus, the routing files, or the condition machinery.
Any check edit after a pilot run must be recorded in the PR description that makes it.

### Metrics

- **success**: binary, from the task's check script.
- **turns / tokens / cost**: parsed from the claude CLI's terminal NDJSON `result` message
  (emitted as a `usage` event by `src/agent/claude-agent.ts`). Other backends report "n/a".
  Note that `tokens in` is the raw `input_tokens` figure only — the bulk of context arrives
  as **cache read** tokens, reported in its own column; judge context cost from that one.
- **docs reads / corpus opened**: how many corpus files the agent opened, counted from the
  run's NDJSON transcript by the runner (backfilled from `logs/` by `eval:report` for older
  runs). Distinguishes "docs ignored" from "docs read but unhelpful/overridden". This is a
  **lower bound**: it counts Read-tool `file_path`s only, so corpus content reached via Grep
  output is not counted (v1 runs showed passing answers with zero counted reads).
- **elapsed**: harness wall-clock, always present.

At least 2 repetitions per condition; the report shows `median (min–max)` spread, never bare
point estimates.

## Running

```bash
pnpm test                 # CI smoke path: full pipeline with the fake agent, zero tokens
pnpm eval --dry-run       # print the run matrix
pnpm eval --tasks defect/shell-policy-values --reps 1 --model low   # cheap pilot
pnpm eval                 # real run: no-docs vs saaga-docs, 2 reps, claude/medium
pnpm eval:report --run eval/results/run-<timestamp>                 # write eval/reports/<name>.md
```

Raw results land in `eval/results/` (gitignored). Committed reports live in `eval/reports/`
as a markdown report plus the `summary.json` that regenerates it, named
`<date>-<time>-<backend>-<modelKey>` from the run's start time so repeated runs never
overwrite each other.

### Comparing two runs

```bash
pnpm eval:report --base <run-dir|summary.json> --candidate <run-dir|summary.json>
```

Emits a machine-generated delta report (success deltas per half and condition, per-task
pass-rate changes, cost-median deltas, corpus-opened rates) into `eval/reports/`. The tool
**refuses** to compare runs whose task sets differ — comparability requires the identical
pre-registered task set, so after any task change both sides must be re-run. Reports are
never edited by hand; everything needed for comparison is computed from `summary.json`.

### Pre-registered design for the corpus-regeneration comparison

Committed before the regenerated corpus exists. Old corpus (base) vs new corpus (candidate)
will be judged on, in this order, with the identical **v2** task set and checks throughout:

1. **Code-task delta** in the paired arms at sonnet tier — the headline instrument.
2. **QA non-regression** on the neutral half (`saaga-docs` arm) — at the observed ceiling,
   holding the pass rate after shrinking the corpus is the claim, and any drop is the
   over-trim the depth-preservation probes exist to catch.
3. **Context-cost delta** — cache-read tokens in the `saaga-docs` arm; the old corpus
   measured as pure overhead versus `no-docs` (+9% at equal success), so a smaller corpus
   should shrink it.
4. **Closed-book delta** — the `docs-only` condition, immune to the ceiling: neutral half =
   coverage/depth (v1 caught the `saaga run` coverage gap), defect half = accuracy.
5. **Sensitivity run** at haiku tier (`--model low`), where doc leverage and doc harm have
   room to appear below the ceiling.

Old-corpus v2 baselines required before regeneration: paired sonnet, docs-only sonnet, and
paired haiku.

## Adding a task

Create a module under `eval/tasks/<half>/` exporting an `EvalTask` (see any existing task),
register it in `eval/src/registry.ts`, and keep it condition-blind — the registry test enforces
the forbidden references and the 10–25 task budget. `kind: "answer"` tasks get the ANSWER.md
instruction appended by the runner; `check` uses `checkAnswer()` with positive predicates and,
for defect probes, negative predicates matching the stale claim. `kind: "code"` tasks add a
stub fixture under `fixtures/<slug>/`, `prepare: stubWith(...)`, `targetFiles`/`targetTests`,
`check: checkTests(...)`, and a `CONDITION_SCOPE` entry in the registry. Any task change bumps
`TASK_SET_VERSION` and invalidates standing baselines.

## Caveats

- **Self-reference bias**: Saaga is evaluated on Saaga's own repository.
- **Tiny N, no statistics**: spread only; run-to-run LLM variance is real and undersampled.
- **Regex grading**: correct-but-unusually-worded answers can false-negative; there is no
  LLM judge.
- **Model-tier sensitivity**: a strong model may succeed without docs, a weak one may fail
  with them; results are tied to the backend/model recorded in the report header.
- **Neutral-task authorship**: the PR-derived neutral tasks were authored by someone who had
  read the seed file; selection was mechanical (the three most recent non-bot feature PRs:
  #41, #39, #35), but true blindness was not available.
- **Residual mentions**: README.md and DEVELOPING.md still name `saaga-docs/` in the no-docs
  arm; the files they point at do not exist there, and neither file is auto-loaded into agent
  context, so the leak surface is considered inert.
- **Defect half scope**: it verifies fixes for known defects; it cannot support the headline
  "docs help" claim (and see the duplication finding above for its closed-book limits).
- **Agents cannot run tests**: the restricted shell means no arm can compile or execute
  anything; code tasks are graded by a trusted host-side checker after the agent finishes,
  and the target test files double as the specification the agent reads.
