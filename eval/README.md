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

### Task set: two halves, reported separately

- **Neutral half** (`eval/tasks/neutral/`): depth-preservation probes and verified anchor facts
  from `plans/eval-seed-material.md` (labeled fair to both corpora there), plus three tasks
  derived from real merged PRs. **Only this half supports the headline claim.**
- **Defect half** (`eval/tasks/defect/`): regression probes for the four confirmed stale doc
  claims plus term-collision probes. This half measures whether known documentation defects
  mislead the agent — fix-verification, not general usefulness.

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

## Adding a task

Create a module under `eval/tasks/<half>/` exporting an `EvalTask` (see any existing task),
register it in `eval/src/registry.ts`, and keep it condition-blind — the registry test enforces
the forbidden references and the 10–20 task budget. `kind: "answer"` tasks get the ANSWER.md
instruction appended by the runner; `check` uses `checkAnswer()` with positive predicates and,
for defect probes, negative predicates matching the stale claim.

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
  "docs help" claim.
- **No test-running**: the restricted shell means no arm can compile or run the suite, so
  code-shaped tasks are graded on file state only.
