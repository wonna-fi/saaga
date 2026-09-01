---
title: "Feature: Eval Harness"
type: feature
sources:
  - eval/*.ts
  - eval/src/*.ts
  - package.json
last_verified: 2026-09-01
---

# Feature: Eval Harness

## Overview

A repo-only experiment answering whether the `saaga-docs/` corpus measurably helps a coding agent:
pre-registered tasks run in isolated sandboxes under different documentation conditions, and the
report compares pass rate and cost per condition. Ships in no package.

## Key Concepts

Before working with this feature, understand these concepts:
- [Agent Interface](../concepts/agent-interface.md)
- [Backend Resolution](../concepts/backend-resolution.md)

## Functional Specification

### Mechanism

1. `pnpm eval` validates the registry, resolves a backend, model key and rev, then walks the matrix task → condition → repetition in registry order; `--dry-run` prints it and stops.
2. Each run gets a fresh sandbox: `git archive` of the tracked tree, the answer keys (`eval/`, `plans/`) removed under *every* condition, the condition mutation and the task's `prepare()` applied, and only then one synthetic commit — so neither history nor `git status` reveals what was removed to an agent whose restricted shell still allows read-only git.
3. The agent runs there under a whole-sandbox read/write profile with a restricted shell, bounded by the task's timeout (300 s by default); `check()` scores it from the sandbox alone, and a failing run's `ANSWER.md` or target files are copied to `artifacts/` before teardown.
4. `summary.json` is rewritten after every result, so a crashed run keeps its data. `pnpm eval:report` renders a run as a committed markdown report or differences two runs; `pnpm eval:artifact` rebuilds one HTML page over every committed summary.

The conditions are `no-docs` (corpus and routing surfaces stripped), `saaga-docs` (the tree as-is), `docs-only` (closed-book: only the corpus, `AGENTS.md`/`CLAUDE.md` and `.gitignore` survive) and `openwiki` (stubbed — it needs a pre-generated wiki directory). Tasks come in two halves, reported separately: the **neutral** half measures whether the corpus helps and is the only half supporting that claim; the **defect** half measures whether known-stale claims still mislead.

### Validation Rules

- `validateRegistry()` requires 10–25 tasks with unique ids prefixed by their half; a `kind: "code"` task also needs `prepare()`, `targetFiles`, `targetTests`, a condition scope excluding `docs-only`, and no file stubbed by two tasks.
- Condition applicability lives in the registry, never in a task module — a test greps `eval/tasks/**` to keep every task condition-blind — and `TASK_SET_VERSION` is stamped into every spec, so comparing two runs of differing versions, or of differing task-id sets, is refused rather than rendered.
- Answer tasks are graded by `must`/`mustNot` regexes over `ANSWER.md`; code tasks by running the feature's real vitest files host-side afterwards, with the test files restored from the initial commit first, so editing the tests cannot pass.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Sandbox creation or the agent throws | A `TaskResult` with `error` and `pass: false`; the matrix continues |
| The backend reports no usage events | Token and cost metrics stay undefined and the report prints `n/a` |
| Fewer than 2 repetitions | Warned on stderr and in the report — no spread can be computed from one sample |

## Technical Implementation

### Data Model

| Type/Artifact | Key Fields | Purpose |
|--------|------------|---------|
| `EvalTask` | `id`, `half`, `kind`, `prompt`, `check()`, `prepare?`, `targetFiles?`, `appliesTo?` | One pre-registered task |
| `RunSpec`, `TaskResult` | `rev`, `conditions`, `reps`, `taskIds`, `taskSetVersion`; `pass`, `checkDetail`, `metrics`, `logFile` | What a run was, and how one cell of it came out |
| `eval/results/run-<stamp>/`, `eval/reports/` | `spec.json`, `summary.json`, `logs/`, `artifacts/`; `<stamp>-<backend>-<modelKey>.md` and its `.summary.json` | Raw output (gitignored), and the committed reports with the summary that regenerates each |

### Services/Functions

| Module | Function/Method | Purpose |
|---------|--------|---------|
| `eval/src/runner` | `runEval()`, `countDocsReads()` | The matrix loop, and corpus reads counted from the run's transcript |
| `eval/src/sandbox`, `eval/src/conditions` | `createSandbox()`, `applyCondition()`, `stripDocsRouting()` | The isolated single-commit copy, and the per-condition mutation applied before its commit |
| `eval/src/checks` | `checkAnswer()`, `checkTests()` | Regex grading and execution grading |
| `eval/src/registry` | `EVAL_TASKS`, `TASK_SET_VERSION`, `validateRegistry()`, `selectTasks()` | The task set, its invariants, and `--tasks` selection |
| `eval/src/report-gen`, `eval/src/metrics` | `generateReport()`, `generateComparison()`, `collectMetrics()`, `formatSpread()` | The markdown and delta reports, usage folding, and `median (min–max)` spread |

## Integration Points

- **Depends on**: the [`Agent` interface](../concepts/agent-interface.md) and the backend factory, plus `git` and `tar`; the corpus under test is what the [init workflow](./init-workflow.md) produces.
- **Used by**: nothing — a leaf, run by hand and by a fake-agent smoke path in the test suite.
- **External systems**: the backend CLI, which spends real tokens on any non-fake run.

## Extension Guide

A task is a module under `eval/tasks/<half>/` exporting an `EvalTask`, registered in `eval/src/registry.ts`, and condition-blind: no reference to the corpus, the routing files, or the condition machinery. A code task adds a stub fixture, `prepare: stubWith(...)`, `targetFiles`/`targetTests`, `check: checkTests(...)` and a condition-scope entry. Any change bumps `TASK_SET_VERSION`, which invalidates every committed baseline.
